# AetherGuard 训练数据报告

生成时间：`2026-07-27T16:28:55.955749+00:00`  
固定随机种子：`42`

## 结果

- 请求样本数：1200
- 实际样本数：1200
- 原始源记录：4500
- 复用的已跟踪 SFT 记录：200
- 精确重复移除：3551
- Schema 拒绝：0
- 标签不明确拒绝：450
- 脱敏替换：770

## 切分

- `train`: 958
- `validation`: 122
- `test`: 120

## 类别比例

- `attack`: 420 (35.00%)
- `hard_negative`: 240 (20.00%)
- `normal`: 420 (35.00%)
- `unknown`: 120 (10.00%)

仓库原始安全语料本身是合成测试数据；报告中的 `tracked_synthetic_security_corpus`
表示从已跟踪语料转换而来，不代表生产真实流量。辅助正常、硬负与 unknown 样本均明确标记
为 `generated_auxiliary`，未伪装成真实数据。

## 防泄漏

- 分组键同时考虑规范化 payload 模板、CVE、场景、攻击家族和相似内容哈希。
- 同一 CVE 的记录被绑定到同一 leakage group。
- URL 多次解码、Unicode NFKC、数字/IP/长 opaque token 归一化后再计算相似哈希。
- 跨 split leakage group 重叠：`False`。
- 详细 pairwise 结果见 `ml/data/manifests/dataset-manifest.json`。

## 输入字段检查

原始 JSON 数组的主要字段为 `id`、`type`、`payload`、`severity`、
`expected_detection`、`source_ip`、`timestamp`；部分 zeroday 文件包含 `cve`。
原始记录通常不直接含 `method`、`path`、`headers`、`body`、`query`，脚本从完整 HTTP
payload 解析这些字段，或将孤立 payload 转为标准安全事件。`source_ip` 不写入训练样本。

## 限制

- 标签继承自合成测试语料及明确的确定性辅助模板，尚未经过独立双人安全标注。
- 相似度分组是保守的规范化哈希，不等价于语义嵌入聚类。
- 类别目标受可用且通过 Schema 的样本池约束；不足量记录在 manifest 的
  `categoryShortages` 中。
