#!/usr/bin/env python3
"""Train an AetherGuard QLoRA adapter with assistant-only token loss."""

from __future__ import annotations

import argparse
import hashlib
import inspect
import json
import logging
import os
import random
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import torch
import yaml
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from torch.nn.utils.rnn import pad_sequence
from torch.utils.data import Dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    Trainer,
    TrainerCallback,
    TrainingArguments,
    set_seed,
)


LOGGER = logging.getLogger("aetherguard.qlora")


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config",
        type=Path,
        default=repository_root() / "ml" / "configs" / "qwen3-4b-qlora.yaml",
    )
    parser.add_argument("--model-name", default=None, help="Override model ID with a validated local snapshot path.")
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--resume-from-checkpoint", default=None, help="Checkpoint path or 'auto'.")
    parser.add_argument("--max-length", type=int, default=None)
    parser.add_argument("--lora-r", type=int, default=None)
    parser.add_argument("--lora-alpha", type=int, default=None)
    parser.add_argument("--eval-steps", type=int, default=None)
    parser.add_argument("--smoke-test", action="store_true")
    parser.add_argument("--smoke-train-samples", type=int, default=16)
    parser.add_argument("--smoke-eval-samples", type=int, default=4)
    parser.add_argument("--smoke-steps", type=int, default=3)
    return parser.parse_args()


def configure_logging(output_directory: Path, smoke_test: bool) -> Path:
    logs_directory = repository_root() / "ml" / "logs"
    logs_directory.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    log_prefix = "smoke" if smoke_test else "train"
    log_path = logs_directory / f"{log_prefix}-{timestamp}.log"
    output_directory.mkdir(parents=True, exist_ok=True)

    LOGGER.setLevel(logging.INFO)
    LOGGER.handlers.clear()
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)
    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setFormatter(formatter)
    LOGGER.addHandler(stream_handler)
    LOGGER.addHandler(file_handler)
    return log_path


def load_configuration(arguments: argparse.Namespace) -> dict[str, Any]:
    config_path = arguments.config.resolve()
    with config_path.open("r", encoding="utf-8") as config_file:
        configuration = yaml.safe_load(config_file)
    if not isinstance(configuration, dict):
        raise ValueError(f"training config must be a mapping: {config_path}")

    configuration["_config_path"] = str(config_path)
    if arguments.model_name:
        configuration["local_model_path"] = arguments.model_name
    if arguments.output_dir:
        configuration["output_dir"] = str(arguments.output_dir)
    if arguments.max_length is not None:
        configuration["max_length"] = arguments.max_length
    if arguments.lora_r is not None:
        configuration["lora_r"] = arguments.lora_r
    if arguments.lora_alpha is not None:
        configuration["lora_alpha"] = arguments.lora_alpha
    if arguments.eval_steps is not None:
        configuration["eval_steps"] = arguments.eval_steps
    return configuration


def resolve_repo_path(path_value: str | Path) -> Path:
    candidate_path = Path(path_value)
    return candidate_path if candidate_path.is_absolute() else repository_root() / candidate_path


FORBIDDEN_TRAINING_TOKENS = ("test-closed", "test-independent", "test_closed", "test_independent")


def sha256_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def reject_test_split_path(path_value: str | Path, field_name: str) -> None:
    normalized = str(path_value).replace("\\", "/").lower()
    for token in FORBIDDEN_TRAINING_TOKENS:
        if token.lower() in normalized:
            raise ValueError(
                f"{field_name} must not point at a test split: {path_value} (matched '{token}')"
            )


def verify_dataset_integrity(configuration: dict[str, Any]) -> dict[str, Any]:
    train_path = resolve_repo_path(configuration["train_file"])
    validation_path = resolve_repo_path(configuration["validation_file"])
    reject_test_split_path(configuration["train_file"], "train_file")
    reject_test_split_path(configuration["validation_file"], "validation_file")

    integrity: dict[str, Any] = {
        "datasetVersion": configuration.get("dataset_version"),
        "trainFile": str(configuration["train_file"]),
        "validationFile": str(configuration["validation_file"]),
        "trainSha256": sha256_file(train_path),
        "validationSha256": sha256_file(validation_path),
        "trainBytes": train_path.stat().st_size,
        "validationBytes": validation_path.stat().st_size,
    }

    manifest_value = configuration.get("dataset_manifest")
    if manifest_value:
        manifest_path = resolve_repo_path(manifest_value)
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        integrity["manifestFile"] = str(manifest_value)
        integrity["manifestSha256"] = sha256_file(manifest_path)
        expected_files = manifest.get("files", {})
        for split_name, actual_path, actual_sha256 in (
            ("train", train_path, integrity["trainSha256"]),
            ("validation", validation_path, integrity["validationSha256"]),
        ):
            expected_entry = expected_files.get(split_name)
            if not expected_entry:
                raise ValueError(f"manifest is missing the '{split_name}' file entry: {manifest_path}")
            expected_sha256 = str(expected_entry.get("sha256", "")).lower()
            if expected_sha256 and expected_sha256 != actual_sha256.lower():
                raise ValueError(
                    f"{split_name} SHA-256 mismatch vs manifest: expected {expected_sha256}, "
                    f"got {actual_sha256.lower()} ({actual_path})"
                )
        LOGGER.info(
            "dataset_integrity_verified version=%s manifest=%s",
            integrity["datasetVersion"],
            manifest_path,
        )
    return integrity


def current_git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repository_root(),
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    commit = result.stdout.strip()
    return commit if result.returncode == 0 and commit else None


def load_jsonl_records(dataset_path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with dataset_path.open("r", encoding="utf-8") as dataset_file:
        for line_number, raw_line in enumerate(dataset_file, start=1):
            if not raw_line.strip():
                continue
            loaded_record = json.loads(raw_line)
            messages = loaded_record.get("messages")
            if not isinstance(messages, list) or [message.get("role") for message in messages] != [
                "system",
                "user",
                "assistant",
            ]:
                raise ValueError(f"invalid messages at {dataset_path}:{line_number}")
            records.append(loaded_record)
    if not records:
        raise ValueError(f"dataset is empty: {dataset_path}")
    return records


class AssistantOnlyDataset(Dataset):
    """Tokenized chat records with prompt tokens masked from the loss."""

    def __init__(self, records: list[dict[str, Any]], tokenizer: Any, max_length: int) -> None:
        self.examples: list[dict[str, torch.Tensor]] = []
        dropped_without_assistant_tokens = 0
        truncated_count = 0
        input_token_lengths: list[int] = []
        assistant_token_lengths: list[int] = []
        for record in records:
            messages = record["messages"]
            prompt_messages = messages[:-1]
            # transformers v5: apply_chat_template(tokenize=True) returns only
            # 2 tokens UNLESS return_dict=True is set. return_dict=True is both
            # correct (full id list) and fast (~1ms/call). Eval uses the same.
            prompt_enc = tokenizer.apply_chat_template(
                prompt_messages,
                tokenize=True,
                add_generation_prompt=True,
                return_tensors="pt",
                return_dict=True,
            )
            full_enc = tokenizer.apply_chat_template(
                messages,
                tokenize=True,
                add_generation_prompt=False,
                return_tensors="pt",
                return_dict=True,
            )
            prompt_token_ids = prompt_enc["input_ids"][0].tolist()
            full_token_ids = full_enc["input_ids"][0].tolist()
            input_token_lengths.append(len(full_token_ids))
            if len(full_token_ids) > max_length:
                truncated_count += 1
            truncated_input_ids = full_token_ids[:max_length]
            prompt_length = min(len(prompt_token_ids), len(truncated_input_ids))
            labels = [-100] * prompt_length + truncated_input_ids[prompt_length:]
            assistant_token_count = len(truncated_input_ids) - prompt_length
            assistant_token_lengths.append(assistant_token_count)
            if not any(label_token_id != -100 for label_token_id in labels):
                dropped_without_assistant_tokens += 1
                continue
            self.examples.append(
                {
                    "input_ids": torch.tensor(truncated_input_ids, dtype=torch.long),
                    "attention_mask": torch.ones(len(truncated_input_ids), dtype=torch.long),
                    "labels": torch.tensor(labels, dtype=torch.long),
                }
            )
        if not self.examples:
            raise ValueError("all records lost assistant tokens after max_length truncation")
        self.source_record_count = len(records)
        self.dropped_without_assistant_tokens = dropped_without_assistant_tokens
        self.truncated_count = truncated_count
        self.max_length = max_length
        self.input_token_lengths = input_token_lengths
        self.assistant_token_lengths = assistant_token_lengths
        if dropped_without_assistant_tokens:
            LOGGER.warning("dropped_without_assistant_tokens=%d", dropped_without_assistant_tokens)

    def __len__(self) -> int:
        return len(self.examples)

    def __getitem__(self, index: int) -> dict[str, torch.Tensor]:
        return self.examples[index]


@dataclass
class AssistantOnlyCollator:
    """Right-pad inputs while preserving the -100 loss mask."""

    pad_token_id: int

    def __call__(self, examples: list[dict[str, torch.Tensor]]) -> dict[str, torch.Tensor]:
        return {
            "input_ids": pad_sequence(
                [example["input_ids"] for example in examples],
                batch_first=True,
                padding_value=self.pad_token_id,
            ),
            "attention_mask": pad_sequence(
                [example["attention_mask"] for example in examples],
                batch_first=True,
                padding_value=0,
            ),
            "labels": pad_sequence(
                [example["labels"] for example in examples],
                batch_first=True,
                padding_value=-100,
            ),
        }


def percentile(sorted_values: list[int], fraction: float) -> int:
    if not sorted_values:
        return 0
    index = min(len(sorted_values) - 1, max(0, round(fraction * (len(sorted_values) - 1))))
    return sorted_values[index]


def token_length_statistics(lengths: list[int]) -> dict[str, Any]:
    ordered = sorted(lengths)
    if not ordered:
        return {"count": 0}
    return {
        "count": len(ordered),
        "min": ordered[0],
        "mean": round(sum(ordered) / len(ordered), 2),
        "median": percentile(ordered, 0.50),
        "p90": percentile(ordered, 0.90),
        "p95": percentile(ordered, 0.95),
        "p99": percentile(ordered, 0.99),
        "max": ordered[-1],
        "over512": sum(1 for value in ordered if value > 512) / len(ordered),
        "over768": sum(1 for value in ordered if value > 768) / len(ordered),
        "over1024": sum(1 for value in ordered if value > 1024) / len(ordered),
        "over1536": sum(1 for value in ordered if value > 1536) / len(ordered),
    }


class EvidenceLoggingCallback(TrainerCallback):
    """Write Trainer metrics and GPU memory evidence through both handlers."""

    def on_log(self, args: Any, state: Any, control: Any, logs: dict[str, Any] | None = None, **kwargs: Any) -> None:
        metric_values = dict(logs or {})
        if torch.cuda.is_available():
            metric_values["gpuAllocatedGiB"] = torch.cuda.memory_allocated() / 1024**3
            metric_values["gpuReservedGiB"] = torch.cuda.memory_reserved() / 1024**3
            metric_values["gpuPeakAllocatedGiB"] = torch.cuda.max_memory_allocated() / 1024**3
        LOGGER.info("trainer_metrics=%s", json.dumps(metric_values, ensure_ascii=False, sort_keys=True))


class SignalAwareCallback(TrainerCallback):
    """Convert termination signals into a normal Trainer save-and-stop request."""

    def __init__(self) -> None:
        self.interrupt_requested = False
        signal.signal(signal.SIGINT, self._request_interrupt)
        signal.signal(signal.SIGTERM, self._request_interrupt)

    def _request_interrupt(self, received_signal: int, _frame: Any) -> None:
        LOGGER.warning("received_signal=%s; requesting checkpoint save and graceful stop", received_signal)
        self.interrupt_requested = True

    def on_step_end(self, args: Any, state: Any, control: Any, **kwargs: Any) -> Any:
        if self.interrupt_requested:
            control.should_save = True
            control.should_training_stop = True
        return control


def build_quantization_config(configuration: dict[str, Any]) -> BitsAndBytesConfig:
    compute_dtype_name = str(configuration["bnb_4bit_compute_dtype"])
    compute_dtype = getattr(torch, compute_dtype_name)
    return BitsAndBytesConfig(
        load_in_4bit=bool(configuration["load_in_4bit"]),
        bnb_4bit_quant_type=str(configuration["bnb_4bit_quant_type"]),
        bnb_4bit_use_double_quant=bool(configuration["bnb_4bit_use_double_quant"]),
        bnb_4bit_compute_dtype=compute_dtype,
    )


def load_model_and_tokenizer(configuration: dict[str, Any]) -> tuple[Any, Any, str]:
    model_reference = str(configuration.get("local_model_path") or configuration["model_name"])
    model_revision = None if configuration.get("local_model_path") else configuration.get("model_revision")
    tokenizer = AutoTokenizer.from_pretrained(
        model_reference,
        revision=model_revision,
        use_fast=True,
        trust_remote_code=False,
    )
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    model = AutoModelForCausalLM.from_pretrained(
        model_reference,
        revision=model_revision,
        quantization_config=build_quantization_config(configuration),
        torch_dtype=torch.bfloat16 if configuration["bf16"] else torch.float16,
        device_map={"": 0},
        trust_remote_code=False,
        low_cpu_mem_usage=True,
    )
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(
        model,
        use_gradient_checkpointing=bool(configuration["gradient_checkpointing"]),
        gradient_checkpointing_kwargs={"use_reentrant": False},
    )
    lora_configuration = LoraConfig(
        r=int(configuration["lora_r"]),
        lora_alpha=int(configuration["lora_alpha"]),
        lora_dropout=float(configuration["lora_dropout"]),
        target_modules=str(configuration["target_modules"]),
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora_configuration)
    if configuration["gradient_checkpointing"]:
        model.enable_input_require_grads()
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    return model, tokenizer, model_reference


def count_parameters(model: Any) -> tuple[int, int]:
    total_parameters = 0
    trainable_parameters = 0
    invalid_trainable_parameters: list[str] = []
    for parameter_name, parameter in model.named_parameters():
        total_parameters += parameter.numel()
        if parameter.requires_grad:
            trainable_parameters += parameter.numel()
            if "lora_" not in parameter_name:
                invalid_trainable_parameters.append(parameter_name)
    if invalid_trainable_parameters:
        raise RuntimeError(
            "non-LoRA parameters unexpectedly trainable: " + ", ".join(invalid_trainable_parameters[:20])
        )
    if trainable_parameters == 0:
        raise RuntimeError("no trainable LoRA parameters were found")
    return total_parameters, trainable_parameters


def build_training_arguments(
    configuration: dict[str, Any], output_directory: Path, smoke_test: bool, smoke_steps: int
) -> TrainingArguments:
    training_argument_parameters = inspect.signature(TrainingArguments.__init__).parameters
    evaluation_parameter_name = "eval_strategy" if "eval_strategy" in training_argument_parameters else "evaluation_strategy"
    argument_values: dict[str, Any] = {
        "output_dir": str(output_directory),
        "num_train_epochs": float(configuration["num_train_epochs"]),
        "learning_rate": float(configuration["learning_rate"]),
        "per_device_train_batch_size": int(configuration["per_device_train_batch_size"]),
        "per_device_eval_batch_size": int(configuration["per_device_eval_batch_size"]),
        "gradient_accumulation_steps": int(configuration["gradient_accumulation_steps"]),
        "gradient_checkpointing": bool(configuration["gradient_checkpointing"]),
        "gradient_checkpointing_kwargs": {"use_reentrant": False},
        "bf16": bool(configuration["bf16"]),
        "fp16": bool(configuration["fp16"]),
        "optim": str(configuration["optim"]),
        "warmup_ratio": float(configuration["warmup_ratio"]),
        "lr_scheduler_type": str(configuration["lr_scheduler_type"]),
        "save_strategy": "steps",
        "save_steps": 2 if smoke_test else int(configuration["save_steps"]),
        "eval_steps": 2 if smoke_test else int(configuration["eval_steps"]),
        "logging_steps": 1 if smoke_test else int(configuration["logging_steps"]),
        "save_total_limit": int(configuration["save_total_limit"]),
        "seed": int(configuration["seed"]),
        "data_seed": int(configuration["seed"]),
        "report_to": [],
        "remove_unused_columns": False,
        "load_best_model_at_end": False,
        "dataloader_pin_memory": True,
        "dataloader_num_workers": 0,
        "logging_first_step": True,
        evaluation_parameter_name: "steps",
    }
    if smoke_test:
        argument_values["max_steps"] = smoke_steps
    # transformers v5 renamed/removed several args (e.g. save_safetensors,
    # evaluation_strategy). Keep only params the installed version accepts.
    valid_parameter_names = set(training_argument_parameters)
    filtered_arguments = {k: v for k, v in argument_values.items() if k in valid_parameter_names}
    return TrainingArguments(**filtered_arguments)


def resolve_resume_checkpoint(output_directory: Path, requested_checkpoint: str | None) -> str | None:
    if requested_checkpoint is None:
        return None
    if requested_checkpoint != "auto":
        checkpoint_path = Path(requested_checkpoint).resolve()
        if not checkpoint_path.is_dir():
            raise FileNotFoundError(f"resume checkpoint not found: {checkpoint_path}")
        return str(checkpoint_path)
    checkpoint_candidates = sorted(
        (
            candidate_path
            for candidate_path in output_directory.glob("checkpoint-*")
            if candidate_path.is_dir() and candidate_path.name.removeprefix("checkpoint-").isdigit()
        ),
        key=lambda candidate_path: int(candidate_path.name.removeprefix("checkpoint-")),
    )
    return str(checkpoint_candidates[-1]) if checkpoint_candidates else None


def write_effective_configuration(
    configuration: dict[str, Any], output_directory: Path, model_reference: str, smoke_test: bool
) -> None:
    serializable_configuration = dict(configuration)
    serializable_configuration["effective_model_reference"] = model_reference
    serializable_configuration["smoke_test"] = smoke_test
    (output_directory / "training-config.yaml").write_text(
        yaml.safe_dump(serializable_configuration, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    source_config_path = Path(configuration["_config_path"])
    if source_config_path.is_file():
        shutil.copy2(source_config_path, output_directory / "source-training-config.yaml")


def main() -> int:
    arguments = parse_arguments()
    configuration = load_configuration(arguments)
    output_directory = resolve_repo_path(configuration["output_dir"])
    if arguments.smoke_test and arguments.output_dir is None:
        output_directory = repository_root() / "ml" / "output" / "smoke-test" / (
            f"qwen3-4b-len{configuration['max_length']}-r{configuration['lora_r']}"
        )
    log_path = configure_logging(output_directory, arguments.smoke_test)
    LOGGER.info("effective_configuration=%s", json.dumps(configuration, ensure_ascii=False, sort_keys=True))
    LOGGER.info("log_path=%s", log_path)

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is not available; refusing to run QLoRA on CPU")
    if configuration["bf16"] and not torch.cuda.is_bf16_supported():
        raise RuntimeError("configuration requests bf16 but the GPU/PyTorch combination does not support it")
    set_seed(int(configuration["seed"]), deterministic=False)
    random.seed(int(configuration["seed"]))
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()

    dataset_integrity = verify_dataset_integrity(configuration)
    LOGGER.info("dataset_integrity=%s", json.dumps(dataset_integrity, ensure_ascii=False, sort_keys=True))

    train_records = load_jsonl_records(resolve_repo_path(configuration["train_file"]))
    validation_records = load_jsonl_records(resolve_repo_path(configuration["validation_file"]))
    if arguments.smoke_test:
        train_records = train_records[: arguments.smoke_train_samples]
        validation_records = validation_records[: arguments.smoke_eval_samples]

    start_time = time.perf_counter()
    model, tokenizer, model_reference = load_model_and_tokenizer(configuration)
    train_dataset = AssistantOnlyDataset(train_records, tokenizer, int(configuration["max_length"]))
    validation_dataset = AssistantOnlyDataset(validation_records, tokenizer, int(configuration["max_length"]))

    truncation = {
        "maxLength": train_dataset.max_length,
        "trainSourceRecords": train_dataset.source_record_count,
        "trainUsableExamples": len(train_dataset),
        "trainTruncated": train_dataset.truncated_count,
        "trainDroppedWithoutAssistantTokens": train_dataset.dropped_without_assistant_tokens,
        "validationTruncated": validation_dataset.truncated_count,
        "validationDroppedWithoutAssistantTokens": validation_dataset.dropped_without_assistant_tokens,
        "trainInputTokenLength": token_length_statistics(train_dataset.input_token_lengths),
        "trainAssistantTokenLength": token_length_statistics(train_dataset.assistant_token_lengths),
    }
    drop_ratio = train_dataset.dropped_without_assistant_tokens / max(1, train_dataset.source_record_count)
    truncation["trainDropRatio"] = drop_ratio
    LOGGER.info("truncation_evidence=%s", json.dumps(truncation, ensure_ascii=False, sort_keys=True))
    if not arguments.smoke_test and drop_ratio > 0.001:
        raise RuntimeError(
            f"{train_dataset.dropped_without_assistant_tokens} of {train_dataset.source_record_count} train "
            f"records ({drop_ratio:.4%}) lost all assistant tokens at max_length={train_dataset.max_length}; "
            "above the 0.1% gate — raise max_length or fix the data instead of silently dropping"
        )

    total_parameters, trainable_parameters = count_parameters(model)
    effective_batch_size = int(configuration["per_device_train_batch_size"]) * int(
        configuration["gradient_accumulation_steps"]
    )
    device_properties = torch.cuda.get_device_properties(0)
    startup_evidence = {
        "totalParameters": total_parameters,
        "trainableParameters": trainable_parameters,
        "trainablePercent": 100 * trainable_parameters / total_parameters,
        "trainSamples": len(train_dataset),
        "validationSamples": len(validation_dataset),
        "effectiveBatchSize": effective_batch_size,
        "gpuName": torch.cuda.get_device_name(0),
        "gpuTotalMemoryGiB": device_properties.total_memory / 1024**3,
        "maxLength": configuration["max_length"],
        "loraR": configuration["lora_r"],
        "loraAlpha": configuration["lora_alpha"],
    }
    LOGGER.info("startup_evidence=%s", json.dumps(startup_evidence, ensure_ascii=False, sort_keys=True))
    print(json.dumps(startup_evidence, ensure_ascii=False, indent=2), flush=True)

    training_arguments = build_training_arguments(
        configuration, output_directory, arguments.smoke_test, arguments.smoke_steps
    )
    trainer = Trainer(
        model=model,
        args=training_arguments,
        train_dataset=train_dataset,
        eval_dataset=validation_dataset,
        data_collator=AssistantOnlyCollator(tokenizer.pad_token_id),
        callbacks=[EvidenceLoggingCallback(), SignalAwareCallback()],
    )
    write_effective_configuration(configuration, output_directory, model_reference, arguments.smoke_test)
    resume_checkpoint = resolve_resume_checkpoint(output_directory, arguments.resume_from_checkpoint)
    LOGGER.info("resume_checkpoint=%s", resume_checkpoint)
    train_result = trainer.train(resume_from_checkpoint=resume_checkpoint)
    evaluation_metrics = trainer.evaluate()
    trainer.save_model(str(output_directory))
    tokenizer.save_pretrained(str(output_directory))
    trainer.save_state()

    elapsed_seconds = time.perf_counter() - start_time
    summary = {
        "completedAt": datetime.now(UTC).isoformat(),
        "smokeTest": arguments.smoke_test,
        "modelReference": model_reference,
        "baseModelRevision": configuration.get("model_revision"),
        "gitCommit": current_git_commit(),
        "datasetVersion": dataset_integrity.get("datasetVersion"),
        "datasetManifest": dataset_integrity.get("manifestFile"),
        "datasetManifestSha256": dataset_integrity.get("manifestSha256"),
        "trainSha256": dataset_integrity["trainSha256"],
        "validationSha256": dataset_integrity["validationSha256"],
        "outputDirectory": str(output_directory),
        "elapsedSeconds": elapsed_seconds,
        "peakGpuAllocatedGiB": torch.cuda.max_memory_allocated() / 1024**3,
        "peakGpuReservedGiB": torch.cuda.max_memory_reserved() / 1024**3,
        "startup": startup_evidence,
        "truncation": truncation,
        "trainMetrics": train_result.metrics,
        "evaluationMetrics": evaluation_metrics,
        "globalStep": trainer.state.global_step,
        "epoch": trainer.state.epoch,
        "adapterFiles": {
            "adapterModel": (output_directory / "adapter_model.safetensors").is_file(),
            "adapterConfig": (output_directory / "adapter_config.json").is_file(),
            "tokenizerConfig": (output_directory / "tokenizer_config.json").is_file(),
            "trainerState": (output_directory / "trainer_state.json").is_file(),
        },
    }
    summary_path = output_directory / "training-summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    LOGGER.info("training_summary=%s", json.dumps(summary, ensure_ascii=False, sort_keys=True))
    required_artifacts_exist = all(summary["adapterFiles"].values())
    if not required_artifacts_exist:
        raise RuntimeError(f"training completed but required artifacts are missing: {summary['adapterFiles']}")
    return 0


if __name__ == "__main__":
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    raise SystemExit(main())
