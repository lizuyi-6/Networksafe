# ADR: 异构救援控制面（Rescue Control Plane）

- Date: 2026-07-08
- Status: Accepted
- 关联：`docs/plans/2026-07-08-heterogeneous-rescue-control-plane-prd.md`、`docs/rescue/common-cause-failure-matrix.md`、`2026-07-08-rescue-release-policy.md`、`2026-07-08-rescue-auth-storage-network.md`

## Context

主控制面（React + Node.js/Express + Socket.IO + Redis + SQLite/Postgres）是一条共因故障链：同一运行时、同一认证路径、同一 DB schema、同一反向代理规则的缺陷会同时打垮所有副本。PRD 要求引入一条**异构、低功能、默认保守**的救援控制路径，在主控制面不可用或被攻陷时保住状态可见性、隔离能力与审计事实，且不得成为绕过 Gateway Appliance 硬件授权的 fail-open 后门。

## Decision

### 1. 实现形态

- **Rust 单二进制 `ag-rescue`**，源码位于仓库 `rescue/`（独立 crate，不进 rust-fastpath workspace，不共享其 axum/tokio 依赖）。
- **依赖集刻意最小化**：`serde`/`serde_json`/`sha2`/`hmac`/`hex`/`subtle`。无 async runtime、无 Web 框架、无 DB 驱动、无 Redis 客户端。HTTP（仅 loopback/MGMT 只读+安全侧动作）与 CLI 解析用 std 手写。依赖越少，与主控制面的共因故障面越小，供应链面越小。
- 入口：CLI（首选）+ 默认仅监听 `127.0.0.1` 的本地 HTTP + 内嵌只读静态状态页（不引用任何外部资源）。串口/本机 console 模式为后续扩展（transport 已抽象为 trait），是否必须支持由硬件组确认后补充 ADR。

### 2. 能力边界（与 PRD §7.2/§7.3 一一对应）

允许：`status`、`isolate`（仅 `interlock_assert` 方向）、`restart-primary`（allowlist）、`audit export`、`resync`、`doctor`、只读静态页。
禁止（代码层不存在对应路径，而非配置关闭）：通用业务 API 代理、写主业务数据库、发出 `interlock_release` 帧、接入主 JWT/Redis session、挂载到主 Express app。`interlock_release` 的禁止由 `scripts/guards/check-rescue-no-release.mjs` 在源码层强制。

### 3. 与 Gateway Appliance 的协议

复用 M1 daemon 已定义的帧形状（`backend/src/companion/gateway-daemon.ts` 的 `DaemonFrame`/`ControllerFrame`）：newline-delimited JSON。救援面**只发** `{type:"command", command:"interlock_assert", reason, ts}`，**只读** `state`/`heartbeat`/`interlock_result`/`alert` 帧。传输层 MVP 为可配置的本地 TCP/MGMT 端点，抽象为 `ApplianceTransport` trait 以便后续接串口。

### 4. 仲裁规则（主控制面 vs 救援控制面，PRD §5.3）

1. `interlock_assert`/`isolated`/`stop` 恒优先于 `release`；appliance 侧本就如此（任一 fail-closed 触发即断桥），救援面不引入新的仲裁器。
2. 救援面没有 release 能力（见 release 策略 ADR），因此两面唯一可能的"冲突"是主面 release 窗口内救援面 assert——按语义 assert 赢，这正是期望行为。
3. 两面命令都必须留审计：主面走 tamper-evident 主审计，救援面写本地 hash-chain 日志，恢复后 `resync` 补同步且标注来源 `rescue-control-plane`。
4. 状态不确定（帧超时、字段缺失、解析失败）→ 救援面只报告 `unknown` 并保持/建议 isolated，绝不推断"应该没事"。

### 5. 失败语义（fail-closed 映射）

| 异常 | 救援面行为 |
| --- | --- |
| 配置文件缺失/损坏 | 进入 LOCKED 模式：仅 `doctor` 与本地只读状态可用，所有动作命令拒绝 |
| 审计日志不可写 | 拒绝执行任何动作命令（动作必须先落审计再执行） |
| 认证失败 | 拒绝 + 落审计（失败也是事件） |
| appliance 无响应/帧不合法 | 状态报 `unknown`；`isolate` 命令仍可发出（安全侧动作允许在不确定时执行），但结果如实报告未确认 |
| 自身崩溃 | 不影响 appliance 默认 isolated（救援面无守桥职责，桥的常态就是 isolated） |

## Consequences

- 救援面是"另一种生物"：慢、少功能、std-only，换来的是与主面几乎不重叠的故障域（见共因故障矩阵）。
- 手写 loopback HTTP 意味着必须用测试覆盖畸形请求路径；作为交换，消除了 Web 框架这一最大共享依赖。
- 后端需要（后续任务）提供救援审计补同步的 ingest 端点与机器可读状态源；在其落地前 `resync` 只做链校验与载荷生成，属显式缺口。
