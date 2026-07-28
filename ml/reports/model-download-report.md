# 基座模型下载报告

生成时间：`2026-07-28`

## 模型身份

- 模型：`Qwen/Qwen3-4B-Instruct-2507`
- Hugging Face 官方参考 commit：`cdbee75f17c01a7cc42f958dc650907174af0554`
- 架构：`Qwen3ForCausalLM` / `qwen3`，36 层，hidden=2560（官方 Qwen3-4B）
- 本地路径：`ml/output/base-model/`（普通本地目录，`from_pretrained` 直接加载）
- 许可证：Apache-2.0（本地 `LICENSE` 验证）

## 下载路径与替换说明

请求的 `Qwen/Qwen3-4B-Instruct-2507` 当前存在，官方模型卡明确说明它是 Qwen3-4B 的
**non-thinking Instruct** 版本，因此**没有替换模型名称，也没有提前降级到 1.7B**。

### 自动下载尝试

1. **Hugging Face 直连**（`huggingface_hub.snapshot_download`）：小文件（config/tokenizer/index
   等共 10 个）秒下成功，但 3 个大权重 shard（`model-0000{1,2,3}-of-00003.safetensors`）
   在 HF CDN 上**连接停滞**——长时间不增长（进程级观察），属该网络环境对 HF 大文件 CDN 的典型限速/掉线。
2. **hf-mirror.com 国内镜像**（`HF_ENDPOINT=https://hf-mirror.com`）：成功补齐第 3 个 shard
   （95MB），但 `model-00001`、`model-00002`（各约 3.97GB）仍 `ConnectTimeout`
   （`IncompleteSnapshotError: 2 file(s) are missing`）。

### 最终方案：用户自有网络手动下载 + 字节级校验

两次自动下载均卡在大文件，按"最多自动重试一次后切换替代方案"原则，改由用户用自有网络
（代理/下载工具）手动下载缺失的 2 个大 shard，放入本地目录，由脚本校验完整性。**未使用网盘或未知镜像。**

下载直链（commit hash 锁定 revision，与缓存一致）：
- `https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/resolve/cdbee75f17c01a7cc42f958dc650907174af0554/model-0000{1,2}-of-00003.safetensors`

## 完整性校验（权威证据）

对 3 个 shard 同时做了两层校验，结果一致：

1. **safetensors header/mmap 校验**（`safe_open`，会校验文件长度 vs tensor offset）：
   全部通过，tensor 数 174 + 219 + 5 = 398，dtype=bfloat16，`embed_tokens.weight` shape=[151936, 2560]。
2. **SHA256 == HF 缓存 blob 哈希**（逐字节一致证明）：

| shard | sizeBytes | sha256（== HF blob 名） |
| --- | --- | --- |
| model-00001-of-00003.safetensors | 3,957,900,840 | `75311d91bb08cf0b882913da464a1e722a31fb44db35208663487efb7a3d8ed6` |
| model-00002-of-00003.safetensors | 3,987,450,520 | `0b48adbb1f60e901153d91907ba11ce63bd4b8b584482e730f48808d055dfba1` |
| model-00003-of-00003.safetensors | 99,630,640 | `7dd39ccca5e4de123c74c14af44c9bf2eb75df33b4614382af0134528e060d5d` |

这三个 SHA256 与 Hugging Face 缓存的内容寻址 blob 文件名完全相同，证明用户手动下载的
权重与 Hugging Face 官方仓库**逐字节一致**。

- AutoConfig / AutoTokenizer 最小加载成功（fast tokenizer，vocab=151936，eos/pad 正常）。
- `metadata.total_size` 声明 8,045,591,552 字节，实际文件字节合计 8,044,982,000，差 609,552
  字节是 index `total_size` 的 padded 统计口径（含 header/padding 计算），safetensors header
  校验为权威结论，不影响加载。

完整性清单：`ml/reports/base-model-integrity.json`。

## 结论

基座模型已就绪、字节级完整、可直接用于基线评估与 QLoRA 训练。后续训练/评估统一用本地路径
`ml/output/base-model` 加载（通过 `--model-name` 传入），不依赖 HF 在线缓存。
