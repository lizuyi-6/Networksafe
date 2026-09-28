# ASW-HC-006 — HR Employee Record API

- **domain**: `hr_system`
- **attack_family (先验声明)**: `session_after_account_disable`
- **主测不变量**: `authentication_state`

## 人工预期（人写的，不是跑 oracle 抄下来的）

oracle 的判决必须逐字等于下表；不一致 ⇒ 这个世界写错了，修 spec，不是修 oracle
（设计 §12.2）。`observable_decision` 是**可见证据上**的判决，`world_truth` 是
完整状态上的判决——世界声明了矛盾/陈旧/攻击者可控证据时，两者刻意分歧。

| probe | operation | world_truth | observable_decision | 说明 |
| --- | --- | --- | --- | --- |
| P1 | `read` | `safe` | `safe` | Enabled employee Alice reads her own record. |
| P2 | `read` | `attack` | `attack` | Disabled account Mallory still reads employee records. |

## 关键轴（先验声明，Gate 5 据此证伪）

- `actor.ACT-003.authentication_state`: `'disabled'` → `'authenticated'`，期望 `verdict_flip`
- `actor.ACT-001.authentication_state`: `'authenticated'` → `'disabled'`，期望 `verdict_flip`

## 无关轴（Gate 6：世界状态零变化）

- `observation.request.headers.User-Agent`
- `observation.request.headers.X-Request-Id`
- `observation.request.headers.order`
- `observation.rendering.trace_id`
- `observation.rendering.timestamp_format`
- `observation.rendering.display_name_case`

## 备注

Authentication state gate: the actor's own state is the decisive variable.
