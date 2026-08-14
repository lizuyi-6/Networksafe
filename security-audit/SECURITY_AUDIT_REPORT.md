# SECURITY AUDIT REPORT — AetherGuard（最终报告）

- 审计对象：X:\repos\Networksafe @ `7d235411404e03dffe4996e29a82fd74793160d1`（工作树含 38 个未提交修改）
- 审计性质：授权白盒 + 本地最小非破坏动态验证（未修改任何产品代码；产物仅 `security-audit/`）
- 方法：9 阶段（冻结→Recon→威胁模型→分模块审计[主审 backend + 6 子代理]→自动化交叉→数据流深查→验证→对抗复审→盲区二轮→覆盖评审）
- 全部细节：`PHASE0-FREEZE.md` / `REPOSITORY_MAP.md` / `ATTACK_SURFACE.md` / `THREAT_MODEL.md` / `FINDINGS.md` / `SECURITY_COVERAGE.md`；动态 PoC：`poc/deployments-bundle-injection.poc.test.ts`（2/2 PASS）

## Executive Summary

这是一个**防御工程质量显著高于平均水平**的代码库：认证/会话/审计/命令签名链路是审计过的 hardened 代码（防锁定绕过、dummy-hash、refresh 防重放、timingSafeEqual 全覆盖、tamper-evident 审计、7 个 CI guard 实跑全绿）；前端 XSS 主类为零；Rust 零 unsafe；SQL 注入面全线参数化。

但存在**三个结构性例外**，其中两个直接击中产品最核心的安全声明：

1. **FW-001（Critical）**：产品声称"危险操作最终授权由硬件强制（完全最后防线）"，但 M2 STM32 固件**对 grant 不做任何密码学验证**（`se_verify` 为 stub、policyDigest 与硬编码占位符 strcmp）。UART 可达（M1 被攻陷即满足——这恰是产品自己的威胁模型）即可释放物理网络桥。"硬件强制授权"当前在固件层**不成立**；真正强制它的只有 M1 daemon/companion 软件层。
2. **DP-001（Critical，运维级）**：git 历史中提交过明文 FTP 凭证（远程为公开 GitHub 仓库），工作树修复不消除历史泄漏，必须改密+清史。
3. **AG-B01（High，动态 PoC 证实）**：部署 bundle 生成链在 `/generate-bundle`、`/save` 缺失 InputValidator（与 `/generate` 不一致），heredoc marker 注入使恶意 profile 变成客户机 root 级安装脚本，且经 helper 串口 INSTALL 通道持久下发——一个 admin 权限即得部署目标 root RCE 的供应链通道。

另有 1 个可达的 HIGH 依赖漏洞（socket.io-parser 内存耗尽，生产 WS 网关直接暴露）、fastpath sidecar 全 API 无鉴权 + 无限内存增长、以及一组 Medium（config 密钥回显给任意认证用户、静态共享 key 伪身份、SSRF-by-config 等）。

**工作树中未提交的改动全部是正向安全修复**（gate 公钥不可变、seed force 移除、helper 结果签名 fail-closed、agent-auth 缓存绕过修复、固件高水位推进）——但**未提交即未生效**，clean checkout 会回退到修复前状态（FW-011/RS-001 同此）。

## Architecture & Trust Boundaries / Attack Surface

见 `REPOSITORY_MAP.md` §3 与 `ATTACK_SURFACE.md`。要点：公网面收敛到反代 8080（auth + announcements + health 公开，其余鉴权）；四个内部信任域（compose 内网、WS agent/device、UART 设备链、fastpath socket）；最脆边界是 **UART（无认证）**与 **fastpath TCP（无认证）**。

## Confirmed Vulnerabilities（VERIFIED，全量清单见 FINDINGS.md）

| # | ID | Sev | 前提 | 一句话验证 |
| --- | --- | --- | --- | --- |
| 1 | FW-001 | **Critical** | UART/M1 可达（威胁模型内生） | 固件消费明文 grant 字段、SE stub、占位 digest（controller_tasks.c:46-64, se_driver.c:30-56） |
| 2 | DP-001/DP-002 | **Critical**/High | 仓库可读（公网 GitHub） | **HEAD 本身即含** FTP 凭证（`git show HEAD:scripts/list_ftp.ps1`）；且 FTP 全程明文。影响链直达生产 Web 主机写权限（deploy_frontend 经 UploadFile 上传前端产物 → 存储 XSS/篡改） |
| 3 | AG-B01 | **High** | admin 会话（T7） | **动态 PoC PASS**：/generate-bundle 接受 `\n__AETHERGUARD_BUNDLE_1__\n` 注入 → 安装脚本顶级 shell 行；/save 可持久化 |
| 4 | RF-001/002 | **High** | compose 网络内立足点 | 全路由无鉴权；tenant/key 无界 map + window_ms=MAX → 平台级限流清空 / OOM |
| 5 | DP-003 | **High** | 使用 installer 生成密钥 | Math.random() 生成 JWT/审计/加密密钥（config.ts:23-38） |
| 6 | AG-B07 | **Med-High** | 任意认证用户（viewer 可） | GET /api/config 返回 smtp.password + webhook headers（config.routes.ts:15 + service:31-36） |
| 7 | DP-005/006 | **High** | gateway 部署态 | nftables applyRuleset fire-and-forget（spawn error 时 released 态规则残留）+ systemd preflight 二进制从未安装 → fail-closed 桥不变量弱化 |
| 8 | DP-010/011 | Medium | 离线分发 | bundle 无签名（仅 SHA256SUMS，README 自认不防敌手）+ `--skip-verify` 仅 WARN 不中止 |

每个 finding 的完整字段（CWE/数据流/证据/复现/修复）在 `FINDINGS.md` 与各子代理报告。

## Unverified / Rejected

- UNVERIFIED-dynamic：FW-001 真机释放（需硬件）；TRUST_PROXY XFF（配置依赖）。
- REJECTED（对抗复审否决 14 项）：verifyToken 同步误用、scanner 注入、seed force、smart-fix 未鉴权、alerts IDOR、helper 租户伪造、hardware-confirmation IDOR、SQLi、agent 命令伪造、原型污染、XSS、artifact 穿越、rescue release 绕过、device 公钥替换——逐条否决理由见 FINDINGS.md §REJECTED。

## Dependency / Supply Chain / Configuration / Design

- **依赖**：socket.io-parser GHSA-2m8v-j782-fhvr（High，生产可达，`npm audit fix`）；fast-uri/brace-expansion/js-yaml（High，dev 链为主）。
- **供应链**：浮动基镜像（DP-008）、离线 bundle 无签名（DP-010/011）、ML 未锁依赖（ML-001）；**密封挑战测试集约 100 文件被 git-commit 入库（ML-GOV-1）**——密封性仅靠进程纪律，任何 clone 可读全量密封集（离线 bundle 已确认**不含** ml/ ✓）；密封目录内出现 untracked 写入（ML-GOV-2，待查写入者）。
- **配置/部署**：root 容器（DP-013/015）、backend.Dockerfile 失配（DP-014）、已提交私钥（DP-004）。
- **设计弱点**：三套共享静态密钥体系无轮换无身份细分（DEVICE_API_KEYS/VALID_API_KEYS/SERIAL_HELPER_SHARED_SECRET）；M1↔M2 协议字段失配（FW-002）使合法流程也受损；DB_MODE=postgres 文档与实现不一致（写路径 SQLite 取向）；**部署态 appliance 无入站命令通道、requestRelease 零调用（AG-X01）**——远程 release 与 rescue-isolate 均无载体，"最后防线"链路未经部署态端到端运行（双面：攻击面更封闭 / 保证未验证）。

## Recommended Priority

**P0（立即）**
1. FW-001 族：M2 真实验签（SE/公钥）+ 持久化高水位 + 时间源；同时 FW-011 提交未提交的修复
2. DP-001：FTP 改密 → 提交修复 → git 历史清洗 → FTP 日志审计
3. DP-003：installer 改 CSPRNG，已部署密钥全轮换
4. AG-B01：/generate-bundle、/save 补 validateRequest + profile 字符白名单 + heredoc 内容 base64
5. 提交全部工作树中的未提交安全修复（多处 P0 级修复未生效）

**P1（本周）**
6. RF-001/002：fastpath 鉴权 + 条目上限；DEP-01 socket.io-parser 升级
7. DP-005/006：applyRuleset 失败传播 + preflight 安装；DP-010/011 签名 + 移除 skip-verify
8. AG-B07：config 按角色脱敏

**P2（下迭代）**
9. AG-A06/B03b/B02/B04：investigation 迁移到 per-agent registry；codebook/events 租户化；ollama/webhook SSRF 收敛；helper per-helper 凭证
10. FE-001/002/003；RS-001/002；ML-004/010/001

**P3（规划）**
11. 共享密钥体系 → per-device/per-helper 身份 + 轮换机制；compose 内网 mTLS；race-condition 专项轮；ai-agents 管线专项审计

## 结论：我们对此系统究竟掌握到什么程度

- **已证实**：软件控制面（HTTP/WS/审计/命令链）的常规漏洞类基本收敛；产品核心声明（硬件最终授权）在固件层不成立；部署供应链与运维密钥卫生存在真实可利用的 Critical/High。
- **已证伪**：14 类候选被对抗复审否决——这些区域不是"没看"，是"看过并确认安全"。
- **未掌握**：真机固件行为、容器实测网络面、并发窗口、ai-agents 深层、git 全史——已列入 COVERAGE §4/§5，任何"系统已安全"的结论在这些边界内不成立。
