# ASW-HC-016 — Subscription Cancel API

- **domain**: `subscription_system`
- **attack_family (先验声明)**: `repeated_operation`
- **主测不变量**: `one_time_token`

## 人工预期（人写的，不是跑 oracle 抄下来的）

oracle 的判决必须逐字等于下表；不一致 ⇒ 这个世界写错了，修 spec，不是修 oracle
（设计 §12.2）。`observable_decision` 是**可见证据上**的判决，`world_truth` 是
完整状态上的判决——世界声明了矛盾/陈旧/攻击者可控证据时，两者刻意分歧。

| probe | operation | world_truth | observable_decision | 说明 |
| --- | --- | --- | --- | --- |
| P1 | `cancel` | `safe` | `safe` | Alice cancels her subscription with a fresh one-time token. |
| P2 | `cancel` | `attack` | `attack` | Mallory cancels a subscription again with the token she already spent. |

## 关键轴（先验声明，Gate 5 据此证伪）

- `token.TOK-001.used`: `True` → `False`，期望 `verdict_flip`
- `token.TOK-002.used`: `False` → `True`，期望 `verdict_flip`

## 无关轴（Gate 6：世界状态零变化）

- `observation.request.headers.User-Agent`
- `observation.request.headers.X-Request-Id`
- `observation.request.headers.order`
- `observation.rendering.trace_id`
- `observation.rendering.timestamp_format`
- `observation.rendering.display_name_case`

## 备注

Repeated irreversible operation: resource.*.state is not in the L0 critical_axes_whitelist, so the decisive variable is the one-time token.
