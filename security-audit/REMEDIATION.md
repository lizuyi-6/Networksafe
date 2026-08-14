# REMEDIATION — 2026-08 白盒审计修复跟踪

> 本文件是修复账本（FINDINGS.md 为冻结的发现清单，不回写）。
> 每项记录：修复内容、关键文件、验证证据（命令+结果）、提交。

## Batch 1 — P0（PR #22，已合并 master @58dca1f）

| ID | 修复 | 证据 |
| --- | --- | --- |
| AG-B01 (Critical) | /generate-bundle 与 /save 补 InputValidator；PROFILE_STRING_FIELDS 控制字符（`[\u0000-\u001F\u007F]`）拒绝；heredoc marker 改 `randomBytes(16)` 随机 token + 内容碰撞重试；DEPLOYMENT_ID_PATTERN 白名单；bundle 文件路径 containment | PoC 回归 5/5 PASS（jest.audit.config.js） |
| DP-003 (High) | installer generateSecret/generateHexSecret 改 crypto.randomBytes + 拒绝采样（消除模偏差） | installer tsc clean |
| DP-012 (Medium) | 全部 curl\|sh 改 review-or-pin：sha256 打印 +（pin env 校验 \| 交互式确认）；非交互无 pin 中止。因本环境代理按客户端返回不同内容（Invoke-WebRequest vs curl.exe 哈希不一致、get.docker.com RST），**不落库任何 pin 值** | bash -n 两脚本 clean；DP-012 提交信息记录证据 |
| FW-001 (Critical) | M1→M2 串口通道 HMAC-SHA256：固件 grant_auth.c（FIPS 180-4 + RFC 2104，RFC 4231 向量锚定）+ 无密钥即全拒（fail-closed）+ 常时比较；daemon 无 serialChannelKey 拒绝 arm + MAC 附带；simulator 同步强制 | 固件 27/27；后端 27/27（2 新 FW-001 用例）；sim 4/4 + 4 场景 exit 0 |

## Batch 2 — P1（本 PR）

### AG-DEP01 — socket.io-parser GHSA-2m8v-j782-fhvr（High）
- 修复：`npm audit fix` 升 socket.io-parser 4.2.6→4.2.7、fast-uri 3.1.4→3.1.5（prod），加 dev 链 brace-expansion/js-yaml
- 证据：`npm audit`（含 dev）`found 0 vulnerabilities`；lockfile diff 仅 6+31/6-31 行（无意外包变更）；websocket 套件 7 suites 139/139 PASS

### AG-B07 — GET /api/config 泄漏 SMTP 密码与 webhook headers（Medium-High）
- 修复：`platform-config.service.ts` 新增导出 `redactPlatformConfigSecrets`（深拷贝后掩码每个 channel 的 `smtp.password` 与全部 webhook header **值**，保留键名供 UI 渲染）；`config.routes.ts` GET / 仅 `platform_admin` 得原文，其余角色得脱敏副本（同时修复 FE-005 的浏览器内存物化面）
- 证据：config 三套件 115/115 PASS，新增 3 用例（admin 原文 / 非 admin 脱敏 / 缓存不可变性——脱敏绝不回写 service 缓存）

### RF-001/RF-002 — fastpath 无鉴权 + 无界内存（High）
- 修复（rust-fastpath）：
  - 全部 `/v1/*` 路由前置 HMAC-SHA256 请求鉴权（`X-Fastpath-Auth: HMAC-SHA256 <hex>`，MAC 覆盖请求体原文，常时比较；`/healthz` 保持公开供容器探针）；启动 fail-closed：无 `FASTPATH_AUTH_SECRET` 拒绝启动（≥16 字节），`FASTPATH_AUTH_DISABLED=1` 为显式本地开发逃生口
  - 非 loopback TCP bind 由"告警"升级为拒绝启动（需 secret + `FASTPATH_TCP_ALLOW_NON_LOOPBACK=1` 双确认）
  - `window_ms` clamp 至 24h（根除 u64::MAX 饱和 → cleanup 永不回收 → OOM）；tenant+key ≤512 字节；分片条目上限（`FASTPATH_MAX_ENTRIES`，默认 1M）满时驱逐最近过期项并计数（healthz 可见 evictions）
  - `DefaultBodyLimit` 2MiB + 10s 请求超时（slowloris 面）
- 修复（backend）：`fastpath-client.service.ts` axios 请求拦截器对每个请求计算同一 HMAC（buildFastpathAuthHeader，RFC 4231 case 2 向量与 Rust 侧互锚）
- 部署接线：`FASTPATH_AUTH_SECRET` 进 compose `:?` 硬保护（fastpath + backend 两服务）、.env.example、setup.mjs、setup-env.sh、install-offline.sh（三生成器键列表保持同步）
- 证据：cargo test 24/24（新增 7 用例：RFC 向量、缺/错/篡改 MAC 401、GET 路由鉴权、window clamp 可回收、超长 key 400、分片驱逐+evictions 计数、启动姿态 fail-closed 矩阵）；clippy -D warnings 0；后端 fastpath 三套件 45/45 PASS（新增 auth 5 用例）；typecheck clean

### DP-005 — gateway applyRuleset fire-and-forget（High）
- 修复：daemon 启动即同步断言 isolated_ruleset（nft 非 0 退出拒绝启动）；运行期 isolated 应用失败 → `process.exit(1)` 交 systemd 重启（ExecStartPre/ExecStopPost 重断言）；released 应用失败 → 保持隔离（安全态）仅告警
- 证据：tsc 语法级检查（--noResolve 模块解析报错为预期，无语法错误）；行为分支代码内注释锚定

### DP-006 — systemd 引用不存在的 preflight-check 二进制（High）
- 修复：新增 `deployment/gateway/bin/aetherguard-gateway-preflight-check.sh`（应用 isolated_ruleset + `nft list ruleset` 能力验证，非 0 即拒绝启动 daemon）；install.sh 第 [4/7] 步安装至 `/usr/local/bin/aetherguard-gateway-preflight-check`（755）——ExecStartPre 引用自建包起即闭环
- 证据：bash -n clean ×2

### DP-010/DP-011 — 离线 bundle 无签名 + skip-verify 仅警告 + docker 下载无摘要（Medium）
- 修复：
  - build：`--signing-key <私钥>` 对 SHA256SUMS 产生 `SHA256SUMS.sig`（openssl dgst）；`--docker-engine-sha256`/`--compose-plugin-sha256`（或 env）pin 校验不匹配即中止，始终打印并写入 manifest 计算值
  - install：`--skip-verify` 单独使用**直接拒绝**，须 `--skip-verify --accept-unverified` 双确认；bundle 带 .sig 时强制 `--verify-key`，先验签后逐文件校验；README 同步（含构建/安装两侧新旗标说明）
- 证据：bash 实跑分支矩阵——skip-verify 单独 exit 1；带签名无 key exit 1；key 不存在 exit 1；真密钥对 正常安装 exit 0（"vendor signature verified"）；签名后篡改 SHA256SUMS → openssl 验签失败 exit 1

## 验证总账（Batch 2）
- backend `npm run test:all`：4 shards 66+65+65+65 suites / 855+861+856+855 = **3427 tests 全过**（首轮 1 个 SQLITE_BUSY 偶发，复跑 4/4 shards 全绿）
- backend `npm run typecheck` clean；`npm audit` 0 vulnerabilities（含 dev）
- rust-fastpath `cargo test` 24/24、`cargo clippy -- -D warnings` 0
- rescue `cargo test` 51/51、clippy 0
- firmware host tests 27/27
- guards：route-db / repository-hygiene / no-direct-api-fetch / frontend-api-contract 4/4 exit 0
- AG-B01 PoC 回归 5/5 PASS

## 未修复项（后续批次）
- P2：A-06（VALID_API_KEYS 静态身份）、B03b/B02/B04（codebook/events/config 租户过滤）、RF-003/004/005 残余（body limit 已修，连接上限部分）、FE/RS/ML 中低项
- DP-001 运维跟进：FTP 凭证轮换 + git 历史清洗（BFG/filter-repo）+ secret-scan guard——非纯代码可完成
- FW-002/003/004/006/008/011：固件协议字段失配与时钟持久化（需与 M1 真实对接联调）
