# ASW-HC-007 — Ticket API With Flow-Scoped Tokens

- **domain**: `ticketing`
- **attack_family (先验声明)**: `cross_workflow_token_reuse`
- **主测不变量**: `token_lineage`

## 人工预期（人写的，不是跑 oracle 抄下来的）

oracle 的判决必须逐字等于下表；不一致 ⇒ 这个世界写错了，修 spec，不是修 oracle
（设计 §12.2）。`observable_decision` 是**可见证据上**的判决，`world_truth` 是
完整状态上的判决——世界声明了矛盾/陈旧/攻击者可控证据时，两者刻意分歧。

| probe | operation | world_truth | observable_decision | 说明 |
| --- | --- | --- | --- | --- |
| P1 | `read` | `safe` | `safe` | Mallory reads a ticket with the token issued for the read flow. |
| P2 | `read` | `attack` | `attack` | Mallory reuses the profile-flow token TOK-001 on the read flow. |

## 关键轴（先验声明，Gate 5 据此证伪）

- `token.TOK-001.flow_id`: `'FLOW-PROFILE'` → `'FLOW-READ'`，期望 `verdict_flip`
- `token.TOK-002.flow_id`: `'FLOW-READ'` → `'FLOW-OTHER'`，期望 `verdict_flip`

## 无关轴（Gate 6：世界状态零变化）

- `observation.request.headers.User-Agent`
- `observation.request.headers.X-Request-Id`
- `observation.request.headers.order`
- `observation.rendering.trace_id`
- `observation.rendering.timestamp_format`
- `observation.rendering.display_name_case`

## 备注

Token lineage by flow: current_flow.flow_id comes from the action, not the token.
