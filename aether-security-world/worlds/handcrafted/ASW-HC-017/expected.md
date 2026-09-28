# ASW-HC-017 — Assignment Submission API

- **domain**: `school_system`
- **attack_family (先验声明)**: `tenant_mismatch`
- **主测不变量**: `cross_tenant_isolation`, `ownership`

## 人工预期（人写的，不是跑 oracle 抄下来的）

oracle 的判决必须逐字等于下表；不一致 ⇒ 这个世界写错了，修 spec，不是修 oracle
（设计 §12.2）。`observable_decision` 是**可见证据上**的判决，`world_truth` 是
完整状态上的判决——世界声明了矛盾/陈旧/攻击者可控证据时，两者刻意分歧。

| probe | operation | world_truth | observable_decision | 说明 |
| --- | --- | --- | --- | --- |
| P1 | `submit` | `safe` | `safe` | Alice submits to her own tenant's assignment. |
| P2 | `submit` | `attack` | `attack` | Mallory (tenant TEN-002) submits to a TEN-001 assignment. |

## 关键轴（先验声明，Gate 5 据此证伪）

- `actor.ACT-003.privileges`: `['assignment.submit.tenant002']` → `['assignment.submit.tenant001']`，期望 `verdict_flip`
- `actor.ACT-001.privileges`: `['assignment.submit.tenant001']` → `['assignment.submit.tenant002']`，期望 `verdict_flip`

## 无关轴（Gate 6：世界状态零变化）

- `observation.request.headers.User-Agent`
- `observation.request.headers.X-Request-Id`
- `observation.request.headers.order`
- `observation.rendering.trace_id`
- `observation.rendering.timestamp_format`
- `observation.rendering.display_name_case`

## 备注

Carries one deliberately out-of-scope invariant: it must land in skipped, never satisfied. Tenant crossing is expressed as a tenant-scoped privilege because actor.*.tenant is not in the L0 critical_axes_whitelist.
