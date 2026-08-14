# THREAT MODEL — AetherGuard

## 1. 资产（按价值排序）

| 资产 | 位置 | 保护机制 |
| --- | --- | --- |
| **物理网络桥（SERVER↔LAN/WAN interlock 继电器）** | M4 硬件 | 硬件 grant 签名链（声称）、fail-closed、monotonic counter、challenge 去重 |
| 管理员账号 / 平台控制权 | backend users 表 | bcrypt(12)、锁定、OIDC MFA、会话/黑名单 |
| Agent 凭证（apiKey+secretKey HMAC） | agent_registrations（secret AES-GCM 加密） | onboarding code 单用途、hash 存储 |
| 12 项共享密钥（JWT/审计/加密/设备命令/helper） | .env（生成器产生） | compose :?、runtime-env 弱值硬拒 |
| 多租户数据（alerts/findings/流量会话/审计） | SQLite/Postgres | tenantId 域过滤 + PLATFORM_TENANT_ID |
| 固件/部署 artifact | MinIO/data/artifacts | 路径防逃逸、bundle 签名（待查） |
| 密封 ML 测试集（含 raw-private 凭据） | ml/data/**（gitignored 部分） | DO_NOT_READ.md 进程控制 + CI guard（仅 committed） |

## 2. 攻击者画像

| # | 攻击者 | 能力 | 动机/目标 |
| --- | --- | --- | --- |
| T1 | 匿名网络攻击者 | 触达 127.0.0.1:8080 反代（若暴露）/ auth 端点 | 登录、枚举、DoS |
| T2 | 低权租户用户（tenant/viewer/operator） | 合法 JWT | 越权到其它租户/平台（IDOR、权限绕过） |
| T3 | 持 onboarding code 者 / 持静态 API key 者 | 伪 agent/设备注册、investigation 路由 | 凭证滥用、租户伪装 |
| T4 | **受管服务器 root（产品核心威胁模型）** | 控制 host agent、注入流量、伪造 threat 上报 | 让控制面误判、诱骗封禁、**绕过 Root-Resistant 闸门恢复网络** |
| T5 | Gateway Appliance 本地攻击者（M1 Linux 被攻陷/物理串口接触） | 串口注入 UART 帧、伪造 heartbeat | **直接释放 interlock（FW-001 证明可行）** |
| T6 | helper secret 持有者（部署助手主机被攻陷） | final-defense 状态上报、串口请求 | 伪造 active 状态、操纵部署结果 |
| T7 | 恶意内部操作员（admin/tenant_admin） | 合法高权 | 在部署生成物中植入后门（B-01）、SSRF 内网 |
| T8 | 本地/co-tenant 进程（同一容器宿主） | 访问 fastpath unix socket | 全平台限流绕过、OOM |
| T9 | 供应链攻击者 | npm/crate/Docker 基镜像/CI | 后门依赖（socket.io-parser 等已知 HIGH） |

## 3. 信任边界与穿越规则

1. **互联网 → 反代**：仅 8080；TLS 终结；CORS 白名单；cookie SameSite=strict
2. **反代 → backend**：compose 内网；`X-Forwarded-*` 仅在 TRUST_PROXY=true 采信
3. **backend ↔ Redis/Postgres/MinIO**：密码 + 网络隔离
4. **backend → host agent（WS）**：API key + HMAC 命令签名 + nonce（T4 假设通道可被监听/注入）
5. **backend/M1 → M2 固件（UART）**：**明文 newline-JSON，无密码学认证**（FW-001：声称的"硬件强制授权"当前不成立）
6. **M2 → M3 SE**：仅 presence-check（I2C），se_verify/se_sign 为 stub
7. **helper → backend**：共享 secret Bearer（无 per-helper 区分、无 nonce）
8. **fastpath ↔ backend**：socket 权限即全部信任

## 4. 关键安全声明 vs 现实（产品"完全最后防线"核验）

| 声明 | 现实 |
| --- | --- |
| "危险操作最终授权由硬件强制" | **M2 不验签**（FW-001）：grant 是明文 JSON，policyDigest 对硬编码占位符 `policy-digest-baseline-v1` 做 strcmp；SE 仅存在性检查。串口可达即可释放继电器 |
| "fail-closed" | 控制面/daemon/companion 侧成立（已测 9 种注入+simulator）；M2 侧解析错误返回 true（FW-008）削弱 |
| "monotonic counter 不可回滚" | 软件三套高水位成立；**M2 RAM-only，断电复位**（FW-006） |
| "grant 过期强制" | M2 `g_current_time_s` 恒 0（FW-004）+ strtoul 负数回绕（FW-003） |
| "M1↔M2 协议一致" | M1 不发 monotonicCounter/expiresAt，M2 必需 → 合法 release 永久 DoS（FW-002） |
| "backend/appliance 构成端到端控制链" | **部署态 wrapper 无任何入站通道且零调用 requestRelease**（AG-X01）——合法 release 与 rescue-isolate 均无载体，端到端链路从未在部署拓扑运行过（与 FW-002 同主题：固件链路未经真实对接）；副作用是攻击面实际更封闭（远程 release 无从触发） |

## 5. STRIDE 摘要（覆盖映射）

- **S(伪装)**：agent hash 验证+缓存修复 ✓；device 共享 key 顶替（部分修复：公钥不可变，无公钥设备仍可顶）→ B-03；investigation 静态 key → A-06
- **T(篡改)**：命令 HMAC ✓；审计 HMAC 链 ✓（rescue 侧 RS-002 吞错）；**UART 帧篡改无防护 → FW-001**；部署生成物无签名约束内容 → B-01
- **R(抵赖)**：tamper-evident 审计（backend+rescue）✓；设备事件仅内存
- **I(泄露)**：前端零 XSS sink ✓；AI endpoint key 掩码 ✓；sync-config 可下发明文 key（admin 自取，FE-005）；密封凭据在磁盘（ml 报告）
- **D(拒绝服务)**：socket.io-parser HIGH（DEP-01）；fastpath OOM（RF-002）；M1/M2 协议失配永久 DoS（FW-002）；brace-expansion（dev）
- **E(提权)**：角色矩阵归一化 ✓；`authenticateApiKey` 造 tenant/ultra 伪用户 → A-06；deployments 模板注入 → B-01（T7 链）

## 6. 最高优先攻击链（Phase 6 动态验证目标）

1. **CHAIN-1（P0）**：T5 串口注入伪造 grant → M2 释放 interlock → 受管服务器恢复网络。前提：物理/UART 或 M1 compromise。全部静态证据成立（FW-001 VERIFIED），动态 PoC 受硬件限制标记 UNVERIFIED-dynamic。
2. **CHAIN-2（P1）**：T7 用 deployments/generate 植入 bash/nginx 注释逃逸 → 客户机 install.sh 以 root 执行 → 后门。静态可证（B-01）。
3. **CHAIN-3（P1）**：DEP-01 socket.io-parser → 匿名 WS 连接内存耗尽 → 控制面 DoS（生产反代后仍可达 WS upgrade）。
4. **CHAIN-4（P2）**：T8 fastpath flush → 全平台限流绕过；配合 RF-002 OOM。
5. **CHAIN-5（P2）**：T3 investigation 静态 key → 伪租户身份注入调查数据/日志污染。
