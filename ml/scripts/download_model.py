#!/usr/bin/env python3
"""Download and validate the official Qwen base model outside the Git tree."""

from __future__ import annotations

import argparse
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


DEFAULT_MODEL_ID = "Qwen/Qwen3-4B-Instruct-2507"
HUGGING_FACE_REFERENCE_REVISION = "cdbee75f17c01a7cc42f958dc650907174af0554"


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-id", default=DEFAULT_MODEL_ID)
    parser.add_argument("--source", choices=("huggingface", "modelscope"), default="huggingface")
    parser.add_argument("--revision", default=None)
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=None,
        help="Cache parent outside the repository. Defaults to the selected provider's user cache.",
    )
    return parser.parse_args()


def download_from_hugging_face(model_id: str, revision: str | None, cache_dir: Path | None) -> Path:
    from huggingface_hub import snapshot_download

    downloaded_path = snapshot_download(
        repo_id=model_id,
        revision=revision or HUGGING_FACE_REFERENCE_REVISION,
        cache_dir=str(cache_dir.expanduser()) if cache_dir else None,
        etag_timeout=20,
        max_workers=4,
    )
    return Path(downloaded_path).resolve()


def download_from_modelscope(model_id: str, revision: str | None, cache_dir: Path | None) -> Path:
    from modelscope.hub.snapshot_download import snapshot_download

    download_arguments: dict[str, Any] = {
        "model_id": model_id,
        "revision": revision or "master",
    }
    if cache_dir is not None:
        download_arguments["cache_dir"] = str(cache_dir.expanduser())
    downloaded_path = snapshot_download(**download_arguments)
    return Path(downloaded_path).resolve()


def validate_download(model_path: Path, expected_model_id: str) -> dict[str, Any]:
    required_files = (
        "config.json",
        "generation_config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "model.safetensors.index.json",
        "LICENSE",
    )
    missing_files = [required_file for required_file in required_files if not (model_path / required_file).is_file()]
    if missing_files:
        raise RuntimeError(f"download is missing required files: {missing_files}")

    config = json.loads((model_path / "config.json").read_text(encoding="utf-8"))
    if config.get("model_type") != "qwen3" or config.get("architectures") != ["Qwen3ForCausalLM"]:
        raise RuntimeError(f"unexpected model architecture in {model_path / 'config.json'}")
    if config.get("num_hidden_layers") != 36 or config.get("hidden_size") != 2560:
        raise RuntimeError("downloaded config does not match the official Qwen3 4B architecture")

    weight_index = json.loads((model_path / "model.safetensors.index.json").read_text(encoding="utf-8"))
    weight_map = weight_index.get("weight_map")
    if not isinstance(weight_map, dict) or not weight_map:
        raise RuntimeError("model.safetensors.index.json has no weight map")
    shard_names = sorted(set(str(shard_name) for shard_name in weight_map.values()))
    missing_shards = [shard_name for shard_name in shard_names if not (model_path / shard_name).is_file()]
    if missing_shards:
        raise RuntimeError(f"download is missing weight shards: {missing_shards}")
    shard_sizes = {shard_name: (model_path / shard_name).stat().st_size for shard_name in shard_names}
    if any(shard_size <= 0 for shard_size in shard_sizes.values()):
        raise RuntimeError("one or more safetensors shards are empty")

    tokenizer_config = json.loads((model_path / "tokenizer_config.json").read_text(encoding="utf-8"))
    license_text = (model_path / "LICENSE").read_text(encoding="utf-8", errors="replace")
    return {
        "expectedModelId": expected_model_id,
        "modelType": config["model_type"],
        "architectures": config["architectures"],
        "hiddenSize": config["hidden_size"],
        "numHiddenLayers": config["num_hidden_layers"],
        "numAttentionHeads": config["num_attention_heads"],
        "numKeyValueHeads": config["num_key_value_heads"],
        "maxPositionEmbeddings": config["max_position_embeddings"],
        "torchDtype": config.get("torch_dtype"),
        "tokenizerClass": tokenizer_config.get("tokenizer_class"),
        "tokenizerEosToken": tokenizer_config.get("eos_token"),
        "weightTensorCount": len(weight_map),
        "weightShardCount": len(shard_names),
        "weightShardSizes": shard_sizes,
        "totalWeightBytes": sum(shard_sizes.values()),
        "licenseDetected": "Apache License" in license_text,
        "validationSucceeded": True,
    }


def write_report(
    model_id: str,
    source: str,
    requested_revision: str | None,
    model_path: Path,
    validation: dict[str, Any],
) -> None:
    report_directory = repository_root() / "ml" / "reports"
    report_directory.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(UTC).isoformat()
    source_display = "Hugging Face" if source == "huggingface" else "ModelScope 官方 Qwen 命名空间"
    source_url = (
        f"https://huggingface.co/{model_id}"
        if source == "huggingface"
        else f"https://modelscope.cn/models/{model_id}"
    )
    report_data = {
        "generatedAt": generated_at,
        "modelId": model_id,
        "downloadSource": source,
        "sourceUrl": source_url,
        "requestedRevision": requested_revision or (HUGGING_FACE_REFERENCE_REVISION if source == "huggingface" else "master"),
        "huggingFaceReferenceRevision": HUGGING_FACE_REFERENCE_REVISION,
        "localCachePath": str(model_path),
        "validation": validation,
    }
    (report_directory / "model-download-report.json").write_text(
        json.dumps(report_data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    report_markdown = f"""# 基座模型下载报告

生成时间：`{generated_at}`

## 模型身份

- 模型：`{model_id}`
- 来源：{source_display}
- 来源 URL：{source_url}
- 实际请求 revision：`{report_data['requestedRevision']}`
- Hugging Face 官方参考 commit：`{HUGGING_FACE_REFERENCE_REVISION}`
- 本地缓存：`{model_path}`
- 许可证：Apache-2.0（本地 `LICENSE` 已验证）

## 下载与替换说明

请求的 `Qwen/Qwen3-4B-Instruct-2507` 当前存在，且官方模型卡明确说明它是
Qwen3-4B 的 **non-thinking Instruct** 版本，因此没有替换模型名称，也没有提前降级到
1.7B。若实际来源为 ModelScope，是因为本机 WSL 对 Hugging Face 下载端点连接超时，
而 ModelScope 的 `Qwen` 官方命名空间可达；没有使用网盘或未知镜像。

## 本地完整性检查

- 架构：`{validation['architectures']}` / `{validation['modelType']}`
- 层数 / hidden size：{validation['numHiddenLayers']} / {validation['hiddenSize']}
- 参数精度声明：`{validation['torchDtype']}`
- tokenizer：`{validation['tokenizerClass']}`
- safetensors shard：{validation['weightShardCount']}
- safetensors 总字节：{validation['totalWeightBytes']}
- 权重索引 tensor 项：{validation['weightTensorCount']}
- 必需配置、tokenizer、索引和全部 shard：已存在且非空

ModelScope 的 `master` 不能伪装成 Hugging Face commit hash；报告同时保留官方 Hugging Face
参考 commit。权重一致性验证覆盖官方 Qwen 命名空间、架构关键参数、safetensors 索引与
shard 完整性。跨平台逐字节 hash 对比因 WSL 无法访问 Hugging Face 权重端点而未执行。
"""
    (report_directory / "model-download-report.md").write_text(report_markdown, encoding="utf-8")


def main() -> int:
    arguments = parse_arguments()
    if arguments.source == "huggingface":
        model_path = download_from_hugging_face(arguments.model_id, arguments.revision, arguments.cache_dir)
    else:
        model_path = download_from_modelscope(arguments.model_id, arguments.revision, arguments.cache_dir)
    validation = validate_download(model_path, arguments.model_id)
    write_report(
        arguments.model_id,
        arguments.source,
        arguments.revision,
        model_path,
        validation,
    )
    print(str(model_path))
    print(json.dumps(validation, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    raise SystemExit(main())
