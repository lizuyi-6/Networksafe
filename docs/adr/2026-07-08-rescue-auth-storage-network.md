# ADR: 救援控制面认证、存储与网络暴露方式

- Date: 2026-07-08
- Status: Accepted
- 关联：`2026-07-08-heterogeneous-rescue-control-plane.md`、PRD §6/§9/§10/§11

## Context

PRD 要求救援面认证不依赖 JWT/Redis，存储不依赖主 DB，网络不经主反向代理。需为三者选定 MVP 方案并固定失败语义。

## Decision

### 1. 认证：离线 HMAC-SHA256 challenge-response

- Provision 阶段生成 256-bit rescue key，存 `rescue-keyring/rescue-auth.key`（hex，文件权限最小化，provision 后只读）。密钥与主系统任何 secret（JWT_SECRET、DEVICE_COMMAND_SECRET 等）**无派生关系**。
- 动作命令流程：客户端取一次性 challenge（含随机 nonce + 过期时间）→ 以 rescue key 计算 `HMAC-SHA256(nonce)` → 服务端 `subtle` 常时比较。challenge 单次有效、默认 60s 过期，防重放。
- 密钥文件缺失/不可读 → 认证子系统报 `locked`，所有动作命令拒绝（fail-closed），只读状态不受影响。
- 硬件 token / TOTP / 双人签名为后续增强，接口预留 `authMethod` 字段；引入前不阻塞 MVP。

### 2. 存储：append-only hash chain + 原子快照

- `rescue-events.log`：每行一个 JSON 事件，含 PRD §9.2 全部 15 字段；`eventHash = SHA-256(previousHash + "\n" + canonical_event_json)`，创世 `previousHash` 为 64 个 `0`。只追加（append 模式打开），不覆盖、不截断。
- `rescue-state.json`：写临时文件 + 原子 rename；解析失败 → 忽略快照、进入只读，不猜测状态。
- `sync-queue.log`：待补同步事件指针，append-only。
- 不使用 SQLite/Postgres/Redis——与主面存储零共享。TPM sealed / WORM 介质为开放问题，不阻塞 MVP。

### 3. 网络暴露

- 默认只监听 `127.0.0.1`；绑定非 loopback 地址必须在配置中显式写 `"allowNonLoopback": true` 且给出具体地址；**代码硬拒 `0.0.0.0`/`::`**（配置写了也拒绝启动 HTTP，降级为 CLI-only 并记审计）。
- 不注册到主反向代理，不提供 CORS 头（同机使用），静态页内嵌于二进制、零外部引用。
- HTTP 语义修正 PRD §10.1 一处：`/rescue/audit/export` 由 `POST` 调整为 `GET`（幂等下载语义）；其余动作端点保持 `POST`。此偏离在此锚定。

### 4. 失败语义汇总（缺省=最严格，对齐全局准则 3.5）

| 缺失/异常 | 结果 |
| --- | --- |
| 配置文件缺失 | LOCKED：仅 doctor/本地只读 |
| auth key 缺失 | 动作全拒，状态只读可用 |
| 审计不可写 | 动作全拒（先审计后执行） |
| 配置要求绑 0.0.0.0 | 拒绝监听，降级 CLI-only |
| 快照损坏 | 只读模式，快照弃用 |

## Consequences

- 单密钥 HMAC 意味着"持有密钥=可执行安全侧动作"；由于动作集只含风险降低类（isolate/restart/export），该风险被能力边界钳制（见 release 策略 ADR）。
- hash chain 防篡改是检测性而非预防性：能证明被截断/改写，不能阻止 root 删除整个文件——因此 `resync` 必须校验链且主审计保留救援事件原始 hash。
