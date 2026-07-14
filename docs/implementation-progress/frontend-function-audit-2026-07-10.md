# 前端功能与自动化覆盖审计（2026-07-10）

## 口径

- `行为覆盖`：E2E 对可观测字段、状态变化或失败响应有断言。
- `渲染覆盖`：只证明路由能渲染、无明显浏览器错误，不证明按钮或后端行为。
- `条件覆盖`：测试在有数据或控件可用时才执行，缺数据时会跳过。
- `未覆盖`：本轮没有可复现的行为证据。
- 本表是静态清单和自动化准备，不是生产、OIDC、真实硬件或 HIL 验收结论。

## 公共路由

| 路由 | 主要功能 | API / 外部依赖 | 当前自动化证据 |
| --- | --- | --- | --- |
| `/` | 中英文切换、页内导航、登录 CTA、隐私入口 | 无 | 行为覆盖：语言、CTA、页内目标；页脚链接有断言 |
| `/login` | 本地密码登录、OIDC 跳转、开发预设、密码显隐 | `/system/mode`、`/auth/login`、`/auth/oidc/login` | 行为覆盖：表单校验、开发预设、SSO-only 分支、登录/登出；真实 OIDC 未覆盖 |
| `/privacy`、`/terms` | 法务内容、返回 | 无 | 渲染覆盖 |
| `/promo`、`/promo-film` | 宣传页、影片播放面 | 浏览器媒体能力 | 渲染覆盖；播放/暂停/媒体失败未覆盖 |
| `/landing-workshop` 及 5 个变体 | 语言、风格导航、FAQ、登录/法务 CTA | 无 | 渲染覆盖；控件逐项交互未覆盖 |
| `/aetherguard-deck` | 可选 pitch deck | `VITE_ENABLE_PITCH_ROUTES` | 默认关闭；仅路由门控，逐页播放未覆盖 |
| `/xiongcai-final` | deck 兼容重定向 | 同上 | 未单独覆盖 |

## 控制台路由

| 路由 | 主要功能 / API | 当前自动化证据 | 未覆盖或条件覆盖 |
| --- | --- | --- | --- |
| `/dashboard` | stats、logs、rule summary、管理员 API key 摘要；时间窗、暂停、JSON/CSV 导出 | 行为覆盖 | 管理员 API key 请求失败分支由页面总错误处理，真实大数据导出未覆盖 |
| `/agents`、`/agents/:id` | 列表、威胁、刷新、触发扫描、详情 | 行为覆盖 + 条件覆盖 | 无在线 agent 时扫描被静默跳过 |
| `/cognition` | 7 层拓扑、角色节点、审计轨迹 | 行为覆盖 | API 失败会回落静态拓扑但没有显式降级标签 |
| `/agent-monitor` | stats/health、刷新、自动刷新 | 行为覆盖；503 显式错误断言 | 多请求部分失败后的旧数据保留语义未覆盖 |
| `/traffic`、`/traffic/sessions/:id` | stats、flows、protocols、threats、刷新、详情 | 行为覆盖；503 显式错误断言 | 大流量分页、WebSocket 更新未覆盖 |
| `/attack-sim`、`/attack-sim/runs/:id` | 选择攻击、按类别展开、运行、终端日志、历史和详情 | 条件覆盖 | 路由依赖 demo 开关；run/types/history 失败仍有空数据回退；真实隔离环境未覆盖 |
| `/devices`、`/devices/board-status/:id` | 设备列表、Final Defense、collect/reboot、配置保存、事件与板状态 | 渲染/详情覆盖；Final Defense 503 => unknown 字段断言 | collect/reboot、配置保存、命令权限、部分 ACK 失败未做 UI 行为覆盖；Reset 死控件已移除 |
| `/hardware-gates` | gate 列表、刷新、P-256 公钥 enrollment | 渲染覆盖 | enrollment 成功/重复/非法 PEM/跨租户拒绝未覆盖；真实 gate 未覆盖 |
| `/deployment-runs` | helper/gate 选择、创建 run、批准 | 渲染覆盖 | 创建、批准、硬件确认和失败分支未覆盖 |
| `/deployment-evidence` | 选择 run、生成证据、JSON 下载 | 渲染覆盖 | 生成/下载/缺失 run 未覆盖 |
| `/sites`、`/sites/:id` | 站点列表、详情、关联告警/流 | 详情覆盖；503 与空列表区分断言 | 无新增/编辑站点功能；分页未覆盖 |
| `/deploy` | 目标选择、配置生成、保存、bundle 下载、重置 | 行为覆盖 | 已退役 ESP32 Web Serial 写入已从 UI 和 E2E 移除；Gateway Appliance 下发应走 deployment run + hardware gate |
| `/scanner`、`/scanner/runs/:id` | URL 扫描、本机显式 opt-in、取消、历史、资产/发现、修复动作、详情 | URL/SSRF/本机 opt-in/详情有行为覆盖 | cancel、修复动作及每种发现选择为条件覆盖；真实扫描器依赖未覆盖 |
| `/history`、`/history/:id` | 修复审计列表、发现详情 | 渲染/详情覆盖 | 只读页，无写操作 |
| `/settings` | 模型目录、AI endpoint CRUD/test/toggle、平台配置/验证、Live、logout | 多数写操作有行为覆盖 | `ModelSelector` 点击只改本地 state，不持久化，是死功能；通知通道各失败分支未覆盖 |
| `/alerts`、`/alerts/:id` | 严重度/状态过滤、单条和批量 acknowledge/investigate/resolve/suppress | 过滤和 API 行为覆盖 | UI 批量选择与部分失败回滚未完整覆盖 |
| `/rules` | 规则/候选/事件、过滤、approve/reject | 过滤与候选详情覆盖 | approve/reject UI 行为依赖候选数据，可能跳过；并发审阅未覆盖 |
| `/admin` | 租户 oversight、timeline/evidence/export、公告、onboarding code、API key、agent revoke、审计校验 | 公告、code、API key 一次性明文有行为覆盖 | evidence 导出、agent revoke、audit verify、全部失败分支未覆盖 |
| `/super-admin`、`/super-admin/users/:id` | 用户列表/详情、role/plan/status、批量操作、密码重置、登录历史 | 用户活动导航/详情渲染覆盖 | role/plan/status、批量和临时密码安全展示未完整覆盖 |

## 导航与权限

- 桌面侧栏覆盖 18 个主入口；管理员入口现在只对 `admin` / `platform_admin` 显示。
- `hardware-gates`、`deployment-runs`、`deployment-evidence` 的导航和路由都要求 governance role；viewer 访问三条路由重定向 `/dashboard` 有字段断言。最终授权仍必须依赖后端 RBAC，本轮未验证全部角色矩阵。
- 侧栏使用 `hidden md:flex`，当前没有移动端菜单或抽屉。移动端登录后无法通过主导航遍历控制台，这是用户工作流缺口。
- 未知路由没有 catch-all/404 页面，会渲染空控制台壳。

## 自动化中的非证明项

- `full-clickthrough.spec.ts` 的 `clickIfUsable()` 在控件不存在、不可见或禁用时返回 `false`，调用者多数不要求 `true`；因此用例绿色不能证明每个按钮都被点击。
- `console-routes.spec.ts` 在详情 API 无数据时执行 `continue`，绿色不能证明所有详情页。
- attack simulator 和 board status 都存在“入口出现才测试”的条件分支。
- E2E 目前成功枚举 19 个 spec / 46 个 Chromium 用例；Firefox、WebKit、移动视口、真实 OIDC、真实 Gateway Appliance、Secure Element、interlock、HIL 均不在本轮证据范围。

## 本轮可复现验证

- 最新 `frontend/dist`（入口 `assets/index-CbTbxBq_.js`）上运行 6 条定向 Chromium 反例：Agent Monitor/Traffic/Sites 的 HTTP 503 显式错误、readiness 失败与不可达、Final Defense 状态不可验证、viewer governance 路由拦截；结果 `6 passed / 0 failed / 0 skipped`，exit 0。
- `npm run lint`：exit 0，`--max-warnings 0`。
- `npm run test:i18n`：`6/6 i18n contract assertions passed`，exit 0。
- `npx playwright test --list --project=chromium`：`46 tests in 19 files`，exit 0。测试枚举只证明用例可发现，不证明未执行的 40 条用例行为成立。

## 仍会折叠为回退数据的调用

- `fetchSystemBadges()`：失败返回全零 badge；侧栏无法区分“零事件”和“badge API 失败”。
- `fetchAttackTypes()` / `fetchAttackHistory()`：非 demo 失败返回空数组。
- `runAttackSimulation()`：非 demo 失败返回 `null`，仅终端显示无结果。
- `fetchMultiAgentTopology()`：失败返回 `null` 并由页面使用静态拓扑，未标注降级。
- `fetchPublishedAnnouncements()`：失败返回空数组；公共公告缺失和请求失败不可区分。

## 退役硬件检索结果

- 活跃前端部署向导不再包含 `navigator.serial`、`AG:REQ:*`、`deploy-write-esp32` 或 `/deployments/esp32-status` 调用。
- demo 资产 ID 已改为 `gateway-appliance-*`，硬件 gate 文案已改为 Gateway Appliance / ECDSA P-256。
- 后端 `deployments.routes.ts` 仍保留 ESP32 status/execute 路由及对应 locale key；这不属于前端修复范围，仍需单独决策删除或隔离到归档兼容层。
