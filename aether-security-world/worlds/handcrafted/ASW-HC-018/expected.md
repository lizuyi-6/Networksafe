# ASW-HC-018 — CRM Contact Update API

- **domain**: `crm`
- **attack_family (先验声明)**: `privilege_version_mismatch`
- **主测不变量**: `privilege_version`

## 人工预期（人写的，不是跑 oracle 抄下来的）

oracle 的判决必须逐字等于下表；不一致 ⇒ 这个世界写错了，修 spec，不是修 oracle
（设计 §12.2）。`observable_decision` 是**可见证据上**的判决，`world_truth` 是
完整状态上的判决——世界声明了矛盾/陈旧/攻击者可控证据时，两者刻意分歧。

| probe | operation | world_truth | observable_decision | 说明 |
| --- | --- | --- | --- | --- |
| P1 | `update` | `safe` | `safe` | Mallory updates with the fresh session SES-002 (snapshot version 3). |
| P2 | `update` | `attack` | `attack` | Mallory updates with the stale session SES-001 (snapshot version 1). |

## 关键轴（先验声明，Gate 5 据此证伪）

- `session.SES-001.privilege_snapshot.privilege_version`: `1` → `3`，期望 `verdict_flip`
- `session.SES-002.privilege_snapshot.privilege_version`: `3` → `1`，期望 `verdict_flip`

## 无关轴（Gate 6：世界状态零变化）

- `observation.request.headers.User-Agent`
- `observation.request.headers.X-Request-Id`
- `observation.request.headers.order`
- `observation.rendering.trace_id`
- `observation.rendering.timestamp_format`
- `observation.rendering.display_name_case`

## 备注

Same invariant category as HC-011 but a different operation/resource type, so the structural dedup layer keeps them apart.
