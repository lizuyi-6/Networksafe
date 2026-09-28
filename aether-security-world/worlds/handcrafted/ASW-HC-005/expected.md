# ASW-HC-005 — Order Read Behind Session Auth

- **domain**: `iam_system`
- **attack_family (先验声明)**: `revoked_session_reuse`
- **主测不变量**: `session_revocation`

## 人工预期（人写的，不是跑 oracle 抄下来的）

oracle 的判决必须逐字等于下表；不一致 ⇒ 这个世界写错了，修 spec，不是修 oracle
（设计 §12.2）。`observable_decision` 是**可见证据上**的判决，`world_truth` 是
完整状态上的判决——世界声明了矛盾/陈旧/攻击者可控证据时，两者刻意分歧。

| probe | operation | world_truth | observable_decision | 说明 |
| --- | --- | --- | --- | --- |
| P1 | `read` | `safe` | `safe` | Mallory reads on her live session SES-001. |
| P2 | `read` | `attack` | `attack` | Mallory reuses SES-002, revoked after an abuse report. |

## 关键轴（先验声明，Gate 5 据此证伪）

- `session.SES-002.revoked`: `True` → `False`，期望 `verdict_flip`
- `session.SES-001.revoked`: `False` → `True`，期望 `verdict_flip`

## 无关轴（Gate 6：世界状态零变化）

- `observation.request.headers.User-Agent`
- `observation.request.headers.X-Request-Id`
- `observation.request.headers.order`
- `observation.rendering.trace_id`
- `observation.rendering.timestamp_format`
- `observation.rendering.display_name_case`

## 备注

Session revocation: ownership is deliberately satisfied so only the session decides.
