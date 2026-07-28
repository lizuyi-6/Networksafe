# AetherGuard ML 环境报告

生成时间：`2026-07-27T16:13:03.082854+00:00`

## 运行环境

- 系统：`Linux-6.18.35.2-microsoft-standard-WSL2-x86_64-with-glibc2.39`
- WSL：`True`
- Python：`3.11.15`
- Python executable：`/mnt/x/repos/Networksafe/ml/.venv/bin/python`

## NVIDIA / CUDA

- `nvidia-smi` 可用：`True`
- GPU 查询：`NVIDIA GeForce RTX 5070 Ti Laptop GPU, 12227, 10707, 610.62`
- `nvcc` 可用：`False`
- 说明：pip 安装的 PyTorch 与 bitsandbytes 使用自带 CUDA runtime，QLoRA 不要求本机安装 `nvcc`。
- PyTorch：`2.11.0+cu128`
- PyTorch CUDA runtime：`12.8`
- `torch.cuda.is_available()`：`True`
- GPU：`NVIDIA GeForce RTX 5070 Ti Laptop GPU`
- Compute capability：`[12, 0]`
- 显存：`11.94000244140625` GiB
- 最小 CUDA 张量运算：`{'succeeded': True, 'result': 140.0}`

## 关键依赖导入

- `torch`: 2.11.0+cu128（导入成功）
- `bitsandbytes`: 0.50.0（导入成功）
- `transformers`: 5.14.1（导入成功）
- `peft`: 0.19.1（导入成功）
- `trl`: 1.9.1（导入成功）
- `datasets`: 5.0.0（导入成功）

## 兼容性结论

RTX 5070 Ti Laptop GPU 属于 Blackwell `sm_120`。本环境要求 PyTorch 2.7 或更高且使用
CUDA 12.8 或更高构建；bitsandbytes 使用包含 `sm120` 的 Linux x86-64 CUDA
12.8+ 官方 wheel。最终是否可用以上面的实际 CUDA 张量运算与依赖导入结果为准。
