# 仓库与数据集检查报告（阶段 4）

生成时间：`2026-07-27`（在上一会话环境/依赖就绪基础上续作）

## 1. 仓库根与关键路径

仓库根：`X:\repos\Networksafe`（WSL 视图 `/mnt/x/repos/Networksafe`）。

| 期望路径 | 是否存在 | 说明 |
| --- | --- | --- |
| `README.md` | ✅ | 项目总览 |
| `backend/` | ✅ | Express API + services + scanner + ai-agents |
| `backend/test-data/` | ✅ | 合成安全数据集与评估报告 |
| `backend/test-data/aetherguard-security-dataset/` | ✅ | 4 个子目录 + 1 个已跟踪 SFT batch |
| `backend/test-data/dataset-eval-report.json` | ✅ | 现有规则引擎评估报告（11KB） |
| `backend/src/services/detection-pipeline.service.ts` | ✅ | 规则+AI 检测管线 |
| `backend/src/scanner/ai-engine.ts` | ✅ | 现有 AI 引擎（运维诊断协议，非本任务判定协议） |
| `backend/src/ai-agents/` | ✅ | 七层多 agent 决策 |
| `.gitignore` | ✅ | 已排除 `ml/.venv`、`ml/output`、模型缓存等 |

## 2. 数据集目录结构

`backend/test-data/aetherguard-security-dataset/` 含四个数据子目录，全部为 JSON 数组文件：

| 子目录 | 文件 | 记录数（manifest 实测） |
| --- | --- | --- |
| `full_test_dataset/` | `00_summary.json` + `01..08` | 1300 |
| `complete_dataset/` | `08..14` + 生成脚本 | 1050 |
| `advanced_dataset/` | `15..23` + 生成脚本 | 1150 |
| `zeroday_dataset/` | `24..33` | 1000 |

另有：
- `aetherguard-sft-batch-001.jsonl`：已跟踪的 200 条 teacher 生成的 SFT 样本。
- `EXPERIMENT_PLAN.md` / `FINAL_SUMMARY_V4.md` / `README.md` / `README_EN.md` / `LICENSE`。

**合计原始记录 4500 条**（manifest `rawRecordsRead`），全部为合成测试语料，非生产真实流量。

## 3. 原始记录字段结构

每个子目录的 JSON 文件均为对象数组。抽样确认主字段（manifest `requestedFieldPresence` 实测 4500 条全量统计）：

| 字段 | 出现次数（/4500） | 说明 |
| --- | --- | --- |
| `id` | 4500 | 样本唯一标识 |
| `type` | 4500 | 攻击类型字符串（如 `sql_injection`、`normal`、`unicode_homoglyph`） |
| `payload` | 4050 | 攻击载荷或完整 HTTP 请求文本（normal 类有时为空） |
| `expected_detection` | 4500 | 布尔，是否应被检出 |
| `severity` | 4500 | `low/medium/high/critical` |
| `source_ip` | 4500 | 合成随机 IP（**不写入训练样本**） |
| `timestamp` | 4500 | 合成时间戳 |
| `pattern` | 100 | 部分记录的检测正则 |
| `cve` | 300 | 仅 zeroday 子目录部分记录含 CVE 编号 |
| `method`/`path`/`headers`/`body`/`query` | 0 | 原始记录**不直接含**这些独立字段 |

关键发现：`method/path/headers/body/query` 在原始记录中**不是独立字段**，而是嵌在 `payload` 字符串里（部分 payload 是完整 HTTP 请求文本）。`build_dataset.py` 的 `parse_http_payload` 会从能解析为 HTTP 请求的 payload 中提取这些字段，无法解析的转为标准安全事件输入。

### 攻击样本示例（`full_test_dataset/01_sql_injection.json`）

```json
{
  "id": "sqli_0000",
  "type": "sql_injection",
  "payload": "' UNION SELECT table_name FROM information_schema.tables--",
  "severity": "critical",
  "expected_detection": true,
  "source_ip": "55.31.193.78",
  "timestamp": "2026-03-13T20:53:41.760267"
}
```

### 正常样本特征

`full_test_dataset/08_normal_traffic.json`、`complete_dataset/14_normal_extended.json`、`advanced_dataset/23_normal_extended.json` 为正常请求；正常记录的 `expected_detection=false`、`type=normal*`。

## 4. 数据使用策略（已在 `build_dataset.py` 落实）

1. **原始语料只读，从不修改**——脚本只读 `backend/test-data/`，产物写到 `ml/data/processed/`。
2. **不全量进训练集**：4500 原始记录经去重（移除 3551 精确重复）、标签清洗（拒 450 条 ambiguous）、类别配额采样后取 1200 条。
3. **脱敏**：`source_ip` 不写入样本；770 处 password/token/email/Bearer 被替换为 `[REDACTED]`/`user@example.invalid`，同时保留攻击语法。
4. **`type` → `attackFamily` 映射**：`map_attack_family` 把 30+ 种原始类型归并到 14 个固定 family。
5. **类别配额**：attack 35% / normal 35% / hard_negative 20% / unknown 10%（不足的 hard_negative/unknown 用明确标记 `generated_auxiliary` 的合成模板补足，manifest 标注来源）。
6. **防泄漏分组切分**：按规范化 payload 模板 + CVE + 编码 + 场景 + 攻击家族 + 内容哈希 + 相似哈希分组，同组强制进同一 split。实测跨 split 共享 leakage group = 0。

## 5. 现有规则引擎评估基线

`backend/test-data/dataset-eval-report.json` 是现有规则检测引擎在原始语料上的评估结果，将在阶段 11（`baseline-vs-lora.md`）作为"规则检测"列复用，与未微调基座、LoRA、规则+LoRA 组合四者对比。

## 6. 结论

仓库状态符合训练前置条件：数据齐全、格式明确、合成来源透明、字段可解析。`build_dataset.py` 已成功生成 train(958)/validation(122)/test(120) 三份通过 Schema 校验、零跨 split 泄漏的 SFT 数据，详见 `dataset-report.md` 与 `dataset-manifest.json`。
