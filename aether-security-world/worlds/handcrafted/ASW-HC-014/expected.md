# ASW-HC-014 — Marketplace Publish API

- **domain**: `api_marketplace`
- **attack_family (先验声明)**: `invalid_state_transition`
- **主测不变量**: `workflow_transition`

## 人工预期（人写的，不是跑 oracle 抄下来的）

oracle 的判决必须逐字等于下表；不一致 ⇒ 这个世界写错了，修 spec，不是修 oracle
（设计 §12.2）。`observable_decision` 是**可见证据上**的判决，`world_truth` 是
完整状态上的判决——世界声明了矛盾/陈旧/攻击者可控证据时，两者刻意分歧。

| probe | operation | world_truth | observable_decision | 说明 |
| --- | --- | --- | --- | --- |
| P1 | `publish` | `safe` | `safe` | Alice publishes her reviewed product. |
| P2 | `publish` | `attack` | `attack` | Mallory publishes a product straight out of draft. |

## 关键轴（先验声明，Gate 5 据此证伪）

- `workflow_instance.WFI-001.current_state`: `'draft'` → `'reviewed'`，期望 `verdict_flip`
- `workflow_instance.WFI-002.current_state`: `'reviewed'` → `'draft'`，期望 `verdict_flip`

## 无关轴（Gate 6：世界状态零变化）

- `observation.request.headers.User-Agent`
- `observation.request.headers.X-Request-Id`
- `observation.request.headers.order`
- `observation.rendering.trace_id`
- `observation.rendering.timestamp_format`
- `observation.rendering.display_name_case`

## 备注

State-machine gate: the attack skips the review transition.
