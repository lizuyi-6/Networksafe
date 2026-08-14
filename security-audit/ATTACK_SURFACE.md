# ATTACK SURFACE — AetherGuard

> 数据流模型：Source → Transformation → Validation → Trust Boundary → Sink → Impact

## A. 网络 reachable 入口（按暴露面排序）

### A1. 生产反代入口 `127.0.0.1:8080`（Nginx → backend:3005）
| 面 | 端点 | 鉴权 | 备注 |
| --- | --- | --- | --- |
| 公开 | `POST /api/auth/login` `register` `refresh` `oidc/*` | rate-limit 120/min + 锁定 + dummy-hash | 枚举/timing 已防 |
| 公开 | `GET /api/announcements` | 无 | 只读 published |
| 公开 | `GET /health*` | 无 | 信息暴露极小 |
| 半公开 | `POST /api/agent-onboarding/exchange` | onboarding code（单用途 1-5 次、TTL≤24h、可选 hostname 绑定） | 凭证发放端点 |
| 认证 | 28 组 `/api/*` 路由 | JWT cookie/header（会话+黑名单+身份再验证）或 API key | 见 REPOSITORY_MAP 矩阵 |
| Helper | `/api/final-defense/status/report`、`/gateways/status/report`、`/api/helpers/*`、`/helpers/:id/serial-request*` | `SERIAL_HELPER_SHARED_SECRET` Bearer | 租户取自已预置记录（V2.2 修复） |
| Agent | `/api/investigation/*` | `VALID_API_KEYS` 静态列表 → 伪 tenant/ultra 用户 | **A-06 候选** |

### A2. WebSocket
- Socket.IO `/ws/agent`（agent: agentId+apiKey hash；dashboard: JWT+60s 会话重验证+撤销踢出；事件级限流；1MB buffer；无 deflate）
- `/ws/device` + `/ws/status`（register: DEVICE_API_KEYS 共享列表 + 公钥不可变；命令 HMAC-SHA256 签名 + nonce）
- **依赖面**：socket.io-parser@4.2.6（GHSA-2m8v-j782-fhvr HIGH，可达）

### A3. 内部服务（compose 网络内）
- fastpath sidecar（unix 0o660 / tcp 127.0.0.1:8081，**无鉴权**——RF-001）
- Postgres / Redis（密码+网络隔离）/ MinIO
- backend → AI 云端（ALLOWED_AI_HOSTS 白名单 + axios）；ollama 类型 allowPrivate（含 169.254.169.254）

### A4. 设备/硬件面
- UART 串口（M1↔M2，newline JSON，**无密码学认证**——FW-001）
- helper ↔ appliance 串口部署通道
- rescue ↔ appliance 控制链（RS 报告）

### A5. 主机 agent（部署在受管服务器，产品假设 root 可被攻陷）
- 接收 WS 命令（HMAC 验签+nonce+5min）；执行 block_ip（execFile+校验）、文件操作
- agent 需持有 apiKey+secretKey（onboarding 发放）

## B. Source → Sink 高危流（Phase 5 深查清单）

| # | Source | Sink | 现状 |
| --- | --- | --- | --- |
| 1 | HTTP body/query 全路由 | SQL（prepare 参数化 + 静态表名） | 参数化已确认；`db.exec` 仅静态 DDL/migration |
| 2 | deployments profile（admin） | bash/nginx/yaml 生成物 → 客户机执行 | **B-01 候选：无转义模板注入（供应链）** |
| 3 | ai-endpoints url（admin） | axios SSRF | 私网仅 ollama 放行（B-02 设计弱点） |
| 4 | scanner targets（admin） | nuclei spawn（数组参数）/exec 固定串 | 注入排除 |
| 5 | WS device data/heartbeat | finalDefense 状态→ 决策显示 | 影响仪表盘真实性（B-03 低） |
| 6 | WS agent threat/review_sample | detection pipeline + 审计 + dashboard 广播 | 限流+租户过滤；注入面=存储型展示 |
| 7 | onboarding code | agent 凭证发放 | hash 存储、审计、撤销链完整 |
| 8 | UART 帧 | M2 grant 校验 → 继电器 release | **FW-001 无验签（Critical）** |
| 9 | fastpath 请求体（本地进程） | 限流状态/内存 | **RF-001/002** |
| 10 | helper secret 持有者 | final-defense 状态伪造 + 部署结果上报 | 租户绑定已修；secret 即全权（B-04 设计） |
| 11 | `x-forwarded-for`（TRUST_PROXY） | 限流 key / 日志 IP | B-05 候选：默认不信任，伪造仅在 TRUST_PROXY=true 时生效 |
| 12 | seed routes（admin+demo） | 全表 DELETE | demo-only + 确认 token（已加固） |
| 13 | admin firmware upload | artifact 存储 → OTA 下发 | base64 25mb 上限；B-06 待查签名链 |
| 14 | LDAP/模板渲染/XSS | — | 前端零 dangerouslySetInnerHTML（FE 报告） |
| 15 | CORS | 白名单 origin 函数 | 精确匹配；null 拒绝 ✓ |

## C. 已识别候选清单（进入 Phase 5/6 验证）

- **A-06** investigation 路由静态 API key → 租户伪装（role=tenant, plan=ultra, tenantId 可从 key 提取或 default-tenant）
- **B-01** deployments 生成物模板注入（`renderNginx` 等直接插值 profile.*；`renderSelfExtractingBundle` heredoc 无转义）
- **B-02** ai-endpoints ollama allowPrivate SSRF（admin-only，云元数据可达）
- **B-03** device `data`/`heartbeat` 直改 finalDefense 状态（共享 key 设备可伪造）
- **B-04** SERIAL_HELPER_SHARED_SECRET 单密钥全权（设计）
- **B-05** TRUST_PROXY 与 XFF 伪造（条件性）
- **B-06** 固件上传→OTA 签名链完整性（待查 deployment-bundle-signing 与固件校验）
- **DEP-01** socket.io-parser HIGH（可达，生产 WS）
- **DEP-02..04** fast-uri / brace-expansion / js-yaml（dev 链为主，brace-expansion 部分运行时）
- 子代理报告：FW-001..011、RF-001..006、FE-001..007、RS-*/ML-*/DP-*（见各自报告）
