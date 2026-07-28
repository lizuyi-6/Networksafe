#!/usr/bin/env python3
"""Fast standalone check: does TrainingArguments accept our filtered params in v5?"""
from __future__ import annotations

import inspect
import tempfile
from pathlib import Path

from transformers import TrainingArguments

cfg = {
    "num_train_epochs": 1, "learning_rate": 1e-4,
    "per_device_train_batch_size": 1, "per_device_eval_batch_size": 1,
    "gradient_accumulation_steps": 16, "gradient_checkpointing": True,
    "bf16": True, "fp16": False, "optim": "paged_adamw_8bit",
    "warmup_ratio": 0.05, "lr_scheduler_type": "cosine",
    "save_steps": 50, "eval_steps": 50, "logging_steps": 5,
    "save_total_limit": 3, "seed": 42,
}
sig = inspect.signature(TrainingArguments.__init__).parameters
eval_key = "eval_strategy" if "eval_strategy" in sig else "evaluation_strategy"
argvals = {
    "output_dir": str(Path(tempfile.mkdtemp())),
    **{k: v for k, v in cfg.items()},
    "gradient_checkpointing_kwargs": {"use_reentrant": False},
    "save_strategy": "steps",
    "seed": 42, "data_seed": 42, "report_to": [],
    "remove_unused_columns": False, "load_best_model_at_end": False,
    "dataloader_pin_memory": True, "dataloader_num_workers": 0,
    "logging_first_step": True, eval_key: "steps",
    "save_safetensors": True,  # should be filtered out in v5
}
dropped = [k for k in argvals if k not in sig]
filtered = {k: v for k, v in argvals.items() if k in sig}
print("dropped (not in v5 signature):", dropped)
ta = TrainingArguments(**filtered)
print("TrainingArguments constructed OK")
print("  bf16=", ta.bf16, "grad_ckpt=", ta.gradient_checkpointing, "optim=", ta.optim)
print("  eval_strategy=", getattr(ta, "eval_strategy", None), "save_steps=", ta.save_steps)
