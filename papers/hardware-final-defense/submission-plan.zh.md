# 投稿建议与执行方案

## 推荐结论

首投建议：**IEEE Access**，稿件类型选 **Research Article**。

理由：

- 这篇论文目前最真实、最强的贡献是一个跨软件控制面、硬件确认门、审计链、外部网络隔离网关设计的系统原型。IEEE Access 接收 IEEE 领域内的原创研究或开发成果，范围比传统安全顶刊更适合这种工程系统型论文。
- 现有证据主要是代码级实现、单元测试、架构守卫、Docker/模拟设备验收和静态/烟测报告，尚缺真实硬件闭环和生产部署。投更专门的安全期刊前，需要补硬件实验和对照实验。
- IEEE Access 官方说明是开放获取期刊，投稿到发表周期标称 4 到 6 周；APC 当前为每篇 2160 美元加税；没有硬性页数上限，但官方强烈建议控制在 20 页以内。
- IEEE Access 投稿清单要求使用 IEEE Access 模板，同时上传 Word/LaTeX 源文件和 PDF；AI 生成文本必须在 acknowledgements 披露；投稿作者需要 ORCID；所有作者需要 biography；如果不确定稿件类型，官方建议选择 Research Article。

备选：

1. **Journal of Information Security and Applications (JISA)**  
   更偏信息安全与应用实践，范围包含 authentication/access control、security management/policies、hardware and physical security。若补上真实 Gateway Appliance 安全控制器/网关硬件闭环实验，JISA 会比 IEEE Access 更“安全期刊味”。

2. **Computers & Security**  
   期刊定位强、审稿更挑。当前稿件若不补真实硬件实验、红队绕过评估、部署案例，直接投中风险较高。该刊支持订阅发表和开放获取发表，开放获取 APC 官方列为 3190 美元加税。注意该刊官方说明从 2024 年起不考虑以 AI/ML 为显著组成的稿件，所以若投稿该刊，应完全聚焦硬件门控和操作安全，不要走多智能体 AI 主线。

## 这篇论文的真实定位

建议题目：

**Hardware-Gated Authorization for Destructive Server Operations: Design and Evidence from the AetherGuard Prototype**

中文理解：

**面向破坏性服务器操作的硬件门控授权：AetherGuard 原型系统设计与证据**

论文应明确说：

- AetherGuard 是一个实现中的安全平台原型，不是已经大规模生产部署的产品。
- 已验证的是软件授权路径、签名 grant、策略摘要绑定、网关状态判定、架构守卫、模拟设备流程和若干验收报告。
- ESP32 串口部署器（已归档）和 Final Defense Gateway Appliance 安全控制器/外部网关是不同硬件形态。
- root-resistant 结论只覆盖真正接入外部网关的网络链路，不覆盖 BMC、备用网卡、Wi-Fi、物理本地控制台、直接磁盘破坏等路径。
- 当前不能声称真实控制板、ATECC608C 安全芯片、外部网关桥接隔离已经完成硬件在环验证。

## 投稿前必须补齐的信息

投稿系统会要求以下信息：

- 作者姓名、单位、邮箱、ORCID。
- 通讯作者信息。
- Funding statement。
- Conflict of interest / competing interests。
- Data availability statement。
- Code availability statement。
- AI assistance disclosure。因为本文由 AI 协助起草，IEEE 投稿时应在 acknowledgments 或声明中披露使用了 OpenAI Codex/ChatGPT 辅助语言组织、结构建议和证据整理，最终技术判断由作者审校。
- 作者 biography。IEEE Access 要求所有作者 biography 放在文末。

## 推荐投稿步骤

1. 用 `papers/hardware-final-defense/manuscript.md` 作为内容底稿，转换到 IEEE Access LaTeX 或 Word 模板。
2. 把图补成 3 张：系统架构图、授权状态机/时序图、root-resistant 外部网关边界图。
3. 把 `papers/hardware-final-defense/evidence-register.md` 压缩成论文附录或 supplemental material。
4. 在正文中保留 limitations，不要删掉“未完成真实硬件闭环验证”的说明。
5. 运行并保存投稿前证据：
   - `cd backend && npm run typecheck`
   - `cd frontend && npm run typecheck`
   - `cd backend && npx jest src/__tests__/services/hardware-authorization.service.test.ts src/__tests__/services/final-defense.service.test.ts --runInBand`
   - `node scripts/guards/check-route-db-access.mjs`
   - `node scripts/guards/check-no-direct-api-fetch.mjs`
6. 建议额外补一个真实硬件实验后再投：
   - Gateway Appliance 安全控制器实物确认一次 `host_remove` 或 `interlock_release`，记录串口日志、后端 audit、UI 状态。
   - 构造 5 个失败用例：签名错误、policyDigest 错误、过期 grant、monotonic counter 回滚、设备断连。
   - 若有外部 Root-Resistant Gateway Appliance，补实际桥接 isolate/release 的端口连通性测试。
7. 在 IEEE Access 投稿入口提交：
   - manuscript PDF；
   - Word 或 LaTeX source；
   - cover letter；
   - supplemental material（代码仓库说明、证据登记表、复现实验脚本）；
   - author biographies；
   - opposed reviewers（可选）。

## Cover Letter 草稿

Dear Editor,

We submit the manuscript "Hardware-Gated Authorization for Destructive Server Operations: Design and Evidence from the AetherGuard Prototype" for consideration as a Research Article in IEEE Access. The paper presents a prototype security architecture in which high-risk server operations are bound to a physically confirmed hardware grant, policy digest, challenge, payload hash, expiry, and monotonic counter before dispatch. The manuscript is intentionally evidence-constrained: it reports repository-traceable implementation and test evidence, and explicitly separates verified software paths from hardware-in-the-loop work that remains future validation.

The contribution is relevant to IEEE Access because it combines distributed server security, hardware-backed authorization, auditable control-plane design, and fail-closed operation boundaries. The manuscript has not been submitted elsewhere.

Sincerely,

[Corresponding Author]

## 官方信息来源

- IEEE Access APC：<https://ieeeaccess.ieee.org/about/article-processing-charges/>
- IEEE Access 投稿指南：<https://ieeeaccess.ieee.org/authors/submission-guidelines/>
- IEEE Access 审稿周期说明：<https://ieeeaccess.ieee.org/about/rapid-peer-review/>
- JISA 期刊范围：<https://www.sciencedirect.com/journal/journal-of-information-security-and-applications>
- Computers & Security 期刊范围和 APC：<https://www.sciencedirect.com/journal/computers-and-security>
