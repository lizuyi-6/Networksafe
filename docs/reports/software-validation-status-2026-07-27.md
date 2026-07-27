# AetherGuard 软件验证状态（2026-07-27）

本报告只覆盖软件能力，不把模拟器结果解释为物理硬件验证，也不把本机 loopback 结果解释为生产 SLA。机器可读结果见同目录下的 `software-validation-status-2026-07-27.json`。

## 1. 版本与环境

- 源码基线：`32b39ff25a909a3a32268fdff1dbe208fffdd4f6`
- 验证时未提交变更：数据集测试名称、样本数说明和 burst 延迟分母修正；评测 artifact schema v2 的分区统计与漏检来源；以及本次文档同步
- 操作系统：Linux `7.0.0-28-generic`，x86_64
- CPU：Intel Core i5-9300H，8 个逻辑 CPU
- 内存：`7,616,966,656` bytes
- Node.js：`v22.22.1`
- npm：`9.2.0`
- Rust：`rustc 1.97.1`、`cargo 1.97.1`
- 运行方式：本机、无 Docker；后端使用 SQLite/sql.js 测试模式并设置 `DISABLE_REDIS=true`

## 2. 结论摘要

| 能力 | 结果 | 证据边界 |
| --- | --- | --- |
| 后端自动化测试 | 248 suites、3,291 tests，全部通过 | 测试模式禁用 Redis；不代表真实 PostgreSQL、Redis、S3、SMTP、OIDC 或 LLM 集成 |
| 后端覆盖率 | statements 65.90%、branches 51.41%、functions 65.90%、lines 66.21% | Jest 全量覆盖率；替代 2026-02-16 报告中的 15–20% 人工估算 |
| 4,500 样本合成数据集 | 检测率 63.97%，合成正常样本 FPR 0% | 3,300 个攻击样本、1,200 个正常样本；不是生产流量指标，也没有外部基线 |
| 数据集评估延迟 | median 0.575 ms、p95 1.612 ms | 2026-07-27 12:47 UTC 最终运行；单进程本机启发式评估，burst 按实际执行请求数计算 |
| Rust fastpath 软件门禁 | 17 tests、Clippy、release build 全部通过 | x86_64 Linux 本机构建 |
| Rescue 软件门禁 | 51 tests、Clippy、release build、12 drills 全部通过 | 纯软件故障演练，不代表真实硬件 interlock |
| Frontend | typecheck、lint、8/8 i18n、credential hygiene、production build 全部通过 | 构建产生约 1.619 MB 主 JS chunk，Vite 给出大于 500 kB 的非阻断警告 |
| Chromium 发布子集 | 10 个可运行用例全部通过；另 1 条按条件跳过 | 使用本机管理员凭据、pitch-disabled 构建和本地前后端；不代表其他浏览器或生产环境 |
| Rust 固定 key rate-check | 三轮均值 59,112 QPS；扫描峰值 75,078 QPS | loopback、200 连接、pipeline 10/20、客户端与服务端共享 CPU；本次未稳定达到 100k |
| Node 开发控制面 `/health` | 三轮均值 3,188 QPS | 单进程开发模式且开启每请求日志；不是生产构建上限 |
| npm 生产依赖审计 | root/backend/e2e/installer/simulator 为 0；frontend 有 2 个 moderate | 前端问题来自 React Router 公告；未自动修改依赖图 |

## 3. 数据集评估

执行命令：

```bash
cd backend
NODE_ENV=test \
JWT_SECRET=test-jwt-secret-minimum-32-characters-long \
AUDIT_LOG_SECRET=test-audit-log-secret-minimum-32-characters \
DISABLE_REDIS=true \
node node_modules/jest/bin/jest.js \
  src/__tests__/dataset/dataset-evaluation.test.ts \
  --runInBand --silent
```

总结果：

| 样本 | TP | FN | TN | FP | 检测率 | FPR | median | p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 4,500 | 2,111 | 1,189 | 1,200 | 0 | 63.97% | 0.00% | 0.575 ms | 1.612 ms |

子数据集结果：

| 子数据集 | 样本 | 攻击 | TP | FN | 正常 | TN | FP | 检测率 | 正常样本 FPR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full_test_dataset | 1,300 | 1,100 | 979 | 121 | 200 | 200 | 0 | 89.00% | 0.00% |
| complete_dataset | 1,050 | 550 | 327 | 223 | 500 | 500 | 0 | 59.45% | 0.00% |
| advanced_dataset | 1,150 | 650 | 260 | 390 | 500 | 500 | 0 | 40.00% | 0.00% |
| zeroday_dataset | 1,000 | 1,000 | 545 | 455 | 0 | 0 | 0 | 54.50% | 不适用 |

代表性分类结果：

| 分类 | 检测率 | 分类 | 检测率 |
| --- | ---: | --- | ---: |
| command_injection | 100% | sql_injection | 64% |
| xss | 98% | path_traversal | 70% |
| brute_force | 100% | ssrf | 20% |
| ddos | 100% | jwt_attack | 24% |
| port_scan | 100% | encoding_bypass | 13% |
| file_upload | 100% | prototype_pollution | 18% |
| http_smuggling | 100% | type_confusion | 11% |
| log4j_injection | 100% | unicode_homoglyph | 6% |

因此，数据集文档中的“基础 >95%、高级 >90%、0day >85%”只能作为历史目标，不能作为已经达到的结果。原先 92.2% 检测率、1.19% FPR、与 Suricata/ModSecurity 的显著性比较和消融数据没有可复现原始 artifact，本报告不采用这些数字。

`dataset-eval-report.json` schema v2 还记录了每个攻击类型和子数据集的计数与延迟，并为每个存在漏检的类型最多保留 5 个代表性 FN，包含来源子数据集和 JSON 文件名。当前没有 FP 样例。代表性缺口包括 loopback SSRF URL、多重编码路径、Unicode 同形字、类型混淆、GraphQL/NoSQL 结构和原型污染；这些样例是后续规则改进输入，而不是把所有漏检载荷完整复制进本报告。

## 4. 自动化测试与覆盖率

后端 `npm run test:coverage -- --runInBand --silent` 结果：

| suites | tests | statements | branches | functions | lines | 结果 |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 248 | 3,291 | 65.90% | 51.41% | 65.90% | 66.21% | 全部通过 |

覆盖率运行使用 `NODE_ENV=test` 和 `DISABLE_REDIS=true`。测试中通过的 mock、in-memory 或 SQLite 路径不能替代 live Redis、PostgreSQL、S3 Object Lock、外部 IdP、SMTP/Slack 或真实模型服务的验收。

其他门禁结果：

- Frontend：typecheck、lint、i18n `8/8`、credential hygiene、production build 通过。
- Rust fastpath：17/17 tests、Clippy `-D warnings`、release build 通过。
- Rescue：51/51 tests、Clippy、release build、12/12 software drills 通过。
- Simulator：typecheck、invalid signature、counter rollback、stale heartbeat、E-stop 场景通过；只属于模拟器证据。
- PM2 发布回归：4/4，通过正常发布、readiness 回滚、SOURCE_SHA 拒绝和 symlink tarball 拒绝。
- Offline env backfill：1/1 通过。
- 项目守卫：31 个 required files、10 个 run configurations；109 个前端 API 调用均解析到 170 个后端注册路由；release guards 全部通过。

## 5. Chromium E2E

测试目标为本地前端 `http://127.0.0.1:5173` 和后端 `http://127.0.0.1:3005`。测试使用 `backend/.env` 中的本机管理员凭据，并设置 `E2E_EXPECT_PITCH_ROUTES_DISABLED=true` 验证 pitch-disabled 构建。

2026-07-27 12:31 UTC 完整 Chromium 发布子集结果：

- 10 passed
- 0 failed
- 1 skipped（只在 pitch-enabled build 运行）

此前暴露的 feature-route 重定向契约和认证后 API 503 均在最终完整子集中通过。walkthrough 单独复跑也为 1/1 通过。该结论只覆盖列出的 Chromium 发布子集，不能扩展为所有浏览器、所有 E2E 文件或生产部署验收。

当前只安装并验证 Chromium。Firefox、WebKit、Edge 和其他操作系统未验证。

## 6. 性能复测

### 6.1 Rust fastpath 固定 key

release binary 绑定 `127.0.0.1:8081`。固定请求：

```json
{"tenantId":"validation","key":"fixed-hot-key","windowMs":600000,"limit":1000000000}
```

三轮参数为 200 connections、pipeline 10、每轮 20 秒：

| 轮次 | QPS | 请求数 | 平均延迟 | p99 | errors | timeouts | non-2xx |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 61,552.8 | 1,231,012 | 32.47 ms | 78 ms | 0 | 0 | 0 |
| 2 | 59,200.8 | 1,184,117 | 33.73 ms | 78 ms | 0 | 0 | 0 |
| 3 | 56,581.6 | 1,131,627 | 35.25 ms | 79 ms | 0 | 0 | 0 |

短阶梯扫描峰值为 75,078 QPS（200 connections、pipeline 20、p99 108 ms、0 errors）。继续增加到 400–800 connections 只增加延迟，没有达到 100k。

同一会话更早曾观察到 101,984、101,105 和 100,657 QPS，但原始完整参数没有版本化，且本次固定 key 复核未能复现。因此，该历史结果只能写为“曾观察到的 loopback 峰值”，不能写为稳定能力或生产 SLA。最新可复现结论是：本次固定 key 热路径没有稳定达到 100k。

### 6.2 Node 控制面

对本地单进程开发服务 `/health` 运行 100 connections、pipeline 10、每轮 15 秒：

| 轮次 | QPS | p99 | errors | timeouts | non-2xx |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 3,119.94 | 451 ms | 0 | 0 | 0 |
| 2 | 3,242.47 | 362 ms | 0 | 0 | 0 |
| 3 | 3,202.87 | 398 ms | 0 | 0 | 0 |

该结果包含开发运行时和每请求日志开销；不应与 production build、cluster 或独立压测机结果混用。无论采用本次结果还是此前约 10.7k 的历史结果，Node 控制面都没有 100k 证据。

## 7. 供应链审计

| 包 | 结果 |
| --- | --- |
| root | 0 vulnerabilities |
| backend | 0 vulnerabilities |
| e2e | 0 vulnerabilities |
| installer | 0 vulnerabilities |
| simulator | 0 vulnerabilities |
| frontend | 2 moderate vulnerabilities |

前端公告涉及 `react-router` / `react-router-dom` 的 open redirect 和 SSR hydration constructor injection。命令使用 `--audit-level=high` 时退出码仍为 0，因为当前仅有 moderate 项；报告必须保留数量和严重度，而不能只记录退出码。

## 8. 当前无法真实验证的软件声明

以下项目需要当前机器上不存在的服务、凭据、数据集或第二种平台，因此保持“未验证”：

- live PostgreSQL、Redis 和多节点 HA；
- S3/MinIO Object Lock 与保留期 enforcement；
- SMTP、Slack、generic webhook 的真实外部投递；
- 真实 OIDC IdP、PKCE/JWKS 跨服务流程；
- 云端或本地 LLM 的真实推理质量、成本和 `<10ms` 延迟；
- ModSecurity/OWASP CRS、Suricata、Fail2ban 和 iptables 外部基线；
- OWASP Benchmark 完整外部数据集评估；
- Caddy、Apache、Kubernetes 和外部 Linux 主机的生产安装生命周期；
- ARM64、Windows、macOS、Firefox、WebKit 和 Edge；
- `<2% CPU`、`<50MB` agent 资源目标；
- 生产网络、TLS、跨主机、长时间 soak 和容量 SLA。

## 9. 对外口径

可以陈述：

- 当前 x86_64 Linux 本机的软件门禁结果及其测试数量；
- 4,500 条合成语料上的 63.97% 检测率和 0% 合成正常样本 FPR；
- Rust release fastpath 在本次固定 key loopback 复测中为 56.6k–61.6k QPS，短扫描峰值 75.1k QPS，均无错误；
- Rescue 和 gateway simulator 的 fail-closed 软件演练通过。

不得陈述：

- 整个平台、Node 控制面或生产环境稳定 100k QPS；
- 92.2% 生产检测率、1.19% 生产 FPR 或对外部 WAF/IDS 的显著优势；
- live 外部集成、跨平台和硬件能力已经由本报告验证；
- `<10ms local AI`、`<2% CPU` 或 `<50MB` 已达标。
