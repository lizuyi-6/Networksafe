# 落地页工作坊 · 2026-07-05

> 目标:为 AetherGuard 官网重构落地页。产出 **4 个完整风格候选 + 1 个对比枢纽页**,全部挂在 `/landing-workshop` 命名空间下;**现行首页 `/`(`frontend/src/pages/Landing.tsx`)零改动**,晋级/回滚均为一行路由替换。

## 1. 项目梳理(所有文案的事实底座)

四个候选共享同一套从仓库文档提炼的事实,不各说各话:

| 事实 | 来源 |
| --- | --- |
| 产品定位:根权限抵抗型最终防线网关一体机;不替代防火墙/EDR/堡垒机,是它们失效后的最后一层 | `docs/root-resistant-gateway-prd.md` §1/§3 |
| 核心主张(条件式):服务器被 root 完全控制后,受控网络链路的最终放行仍由外置硬件网关决定;成立前提=布线经过 interlock + Final Defense 开启 + 本地策略签名 + SE provision + 全链健康 | 同上 §1.3 + `README.md` Final Defense 节 |
| M1-M4 四模块:工业多网口网关(双 1GbE L2 桥 + 独立 MGMT)→ STM32H5/U5 授权控制器 → Secure Element(OPTIGA Trust M / SE050 / ATECC608B,P-256 私钥不可导出)→ fail-closed interlock(继电器+反馈闭环) | 同上 §4 |
| fail-closed 不变量:policyDigest 跨 4 服务+固件逐字 ===;三套单调计数器高水位各自严格 >;release 带 TTL 必回 isolated;e-stop 锁存需显式复位(ISO 13850);隔离保留 MGMT 恢复通道 | `CLAUDE.md` 安全控制流不变量节 |
| 检测面:七层多智能体管线,正常流量 0% 误报为硬约束;云 AI 不可达时降级透明 | `CLAUDE.md` AI Agent 检测管线节 |
| 三种安装路径:`node scripts/setup.mjs && docker compose up -d --build` / `sudo bash scripts/install.sh` / 离线包 `install.sh`(本轮已实测跑通) | `README.md` Quick Start + `deployment/offline/README.md` |
| 三套对象话术(评委/企业客户/技术评审) | `docs/root-resistant-gateway-prd.md` §2 |
| 品牌声线:"在数据的洪流中,为您点亮安全的灯塔"/"守望流量,安抵未来" | `docs/brand_story.md` |
| **宣传纪律:未经实测的性能数字(100k QPS、<10ms 等)禁止上页面**;量产状态如实标注"原型" | `docs/product_whitepaper.md` Validation Note + 父 PRD 第 15 节 |

页面上出现的数字只用可复现事实:13 项固件 host 测试、9 种 fail-closed 注入场景、M1-M4 四模块、ECDSA P-256、双 1GbE、7 镜像离线包。

## 2. 现状审计(为什么要重构)

现行 `/`(`Landing.tsx` 589 行 + `landingContent.ts` 653 行):

1. **叙事过期**:主线仍是 2025 年的"AI 流量安全/intercept-reason-execute"故事,与当前产品主线(Root-Resistant 网关一体机、硬件最后防线)脱节;
2. **硬件不在场**:M1-M4、fail-closed、条件式承诺——产品最大差异化几乎没有出现;
3. **指标口径风险**:旧文案带有营销化指标,与仓库"宣传口径纪律"冲突;
4. **无诚实边界**:v1 不覆盖范围(BMC/Wi-Fi/市电/未布线链路)未向访客披露,而这恰是本产品建立信任的方式。

## 3. 四个候选(路由均为公开页,互相零共享)

| 变体 | 路由 | 文件 | 风格/受众/赌注 |
| --- | --- | --- | --- |
| A 工业信任 | `/landing-workshop/industrial` | `pages/landing-workshop/LandingIndustrial.tsx` | 暗色工程证据流;安全工程师;"把 fail-closed 讲得越具体,信任越深" |
| B 企业官网 | `/landing-workshop/enterprise` | `pages/landing-workshop/LandingEnterprise.tsx` | 亮色经典企业站(锚点导航/能力矩阵/硬件规格表/三视角话术/FAQ/深色页脚);采购与合规;"像成熟公司是采购最大加分项" |
| C 终端审计 | `/landing-workshop/terminal` | `pages/landing-workshop/LandingTerminal.tsx` | 等宽终端,开机日志+fail-closed 事件流即内容(reason code 与代码同源:`counter_replay_or_rollback`/`policy_digest_mismatch`/`release_window_expired`/estop latch);SRE/红队;"一段诚实的日志胜过十页文案" |
| D 品牌叙事 | `/landing-workshop/story` | `pages/landing-workshop/LandingStory.tsx` | 大字滚动章节,灯塔声线(洪流→守望→防线→克制→承诺);路演/媒体;"先记住为什么,功能自然有人问" |
| 枢纽 | `/landing-workshop` | `pages/landing-workshop/LandingWorkshopHub.tsx` | 四卡对比 + 晋级/回滚说明 |

共同约束:双语(zh/en,跟随浏览器语言,可切换);不调用任何后端 API(纯静态,不受 `check-no-direct-api-fetch`/`check-frontend-api-contract` 约束面影响);诚实边界章节每版必有;CTA 统一指向 `/login`。

## 4. 晋级与回滚

晋级(以企业官网为例),`frontend/src/App.tsx` 的 `/` 路由改一行:

```diff
- <Route path="/" element={<PageWrapper><Landing /></PageWrapper>} />
+ <Route path="/" element={<PageWrapper><LandingEnterprise /></PageWrapper>} />
```

回滚即反向改回。旧 `Landing.tsx` 及其内容文件不移动、不删除。

## 5. 验证记录(2026-07-05)

- `cd frontend && npm run typecheck` —— 断言新增五页 + App.tsx 路由改动类型正确;
- `cd frontend && npm run lint`(`--max-warnings 0`)—— 断言无未用导入/未用变量;
- `cd frontend && npm run build` —— 断言 vite 生产构建可产出;
- `node scripts/guards/check-no-direct-api-fetch.mjs` / `check-frontend-api-contract.mjs` / `check-repository-hygiene.mjs` —— 断言未引入直连 fetch、未破坏 API 契约、无生成物入库。

各命令实际退出码见本次 commit message 与会话报告;任何一项非 0 时本工作坊不得视为完成。

## 6. 后续迭代建议(未做,明确留白)

- 真机截图/录屏素材位:四版均预留了纯文字位,未嵌入 dashboard 截图(现有 `docs/assets` 截图分辨率与主题不一,建议统一重截后再上);
- SEO 元数据(title/description/OG)未按变体差异化——晋级后在 `index.html`/路由层补;
- B 版"预约演示"CTA 目前指向 `/login`,正式官网应接表单或联系渠道;
- 多语言:当前 zh/en 内嵌于组件,若晋级建议迁移到 `frontend/src/locales` 与 i18next 体系统一管理。
