# AetherGuard 学术参考文献汇编

> 版本：v1.0 | 日期：2026-07-15 | 来源：Google Scholar 学术搜索
> 搜索范围：2020-2026 | 语言：英文优先

---

## 一、高优先级参考文献（核心支撑）

以下论文与 AetherGuard 的技术架构直接相关，引用量高，可用于产品白皮书、技术专利、学术合作。

### 1.1 安全芯片与远程证明（Secure Element / TPM）

| # | 标题 | 作者 | 年份 | 引用 | 对 AG 的价值 |
|---|------|------|------|------|-------------|
| 1 | **Remote attestation of confidential VMs using ephemeral vTPMs** | Narayanan et al. | 2023 | **57** | 直接支撑 AG 的 TPM 2.0 远程证明设计，M2 控制器固件 attestation 的学术基础 |
| 2 | **DDS security+: Enhancing DDS with TPM-based remote attestation** | Wagner et al. | 2024 | **12** | TPM 在嵌入式/IoT 通信中的证明方案，可借鉴到 Gateway Appliance 的 M2-M3 通信 |
| 3 | **TPM 2.0-based Attestation of a Kubernetes Cluster** | Piras | 2022 | **8** | 云平台 TPM 证明方案，与 AG 控制平面的 K8s DaemonSet 部署包相关 |
| 4 | **Bridging remote attestation and secure software updates in embedded systems** | Usman et al. | 2026 | **2** | 嵌入式系统安全更新与证明结合，与 AG 固件 OTA 更新链路直接相关 |
| 5 | **Towards stateless post-quantum remote attestation for IoT using TPM and DICE** | Eckel et al. | 2025 | **2** | 后量子时代的远程证明，AG 未来需要考虑的抗量子签名迁移路径 |
| 6 | **Root-of-Trust abstractions for symbolic analysis: Application to attestation protocols** | Fotiadis et al. | 2021 | **10** | 信任根抽象模型，可用于 AG 的 M3 Secure Element 信任根设计论证 |
| 7 | **RFC 9684: YANG Data Model for CHARRA using TPMs** | Birkholz et al. | 2024 | **0** | 工业标准 RFC，挑战-响应式远程证明的标准化协议，AG grant 签名机制可引用 |
| 8 | **TPM-based continuous remote attestation for 5G vNFs on Kubernetes** | Upadhyay et al. | 2025 | **5** | 持续远程证明而非一次性证明，与 AG 的周期性 heartbeat + attestation 设计一致 |

**建议引用场景**：技术白皮书"信任根"章节、专利申请（远程证明 + 硬件 grant 签名）、与 Infineon/NXP 的芯片合作论证。

---

### 1.2 硬件信任根与安全启动（Hardware Root of Trust / Secure Boot）

| # | 标题 | 作者 | 年份 | 引用 | 对 AG 的价值 |
|---|------|------|------|------|-------------|
| 9 | **Secure boot for reconfigurable architectures** | Siddiqui et al. | 2020 | **14** | 安全启动链设计，AG 的 STM32H5 安全启动 + 固件度量启动的直接参考 |
| 10 | **A survey of trust chain in secure embedded systems: From secure boot to TEE applications** | Kim | 2026 | **3** | 信任链完整综述，从硬件根到运行时证明，AG 四模块信任链（M1-M4）的理论框架 |
| 11 | **Root of trust: survey, taxonomy, and open challenges** | Al-Otaiby et al. | 2026 | **0** | 信任根分类学，帮助 AG 在文档中定位 M3 Secure Element 的学术位置 |
| 12 | **Leveraging TPMs for Hardware Rooted Security and Robust Device Encryption** | KVSRP et al. | 2026 | **0** | 硬件根信任 + 设备加密，AG Appliance 可信启动 + 审计日志本地加密的设计依据 |

**建议引用场景**：固件设计文档、硬件 PRD 中"安全启动链"章节、与 STM32/Infineon 的技术合作文档。

---

### 1.3 Fail-Closed 与网络物理安全（Fail-Closed / Cyber-Physical Security）

| # | 标题 | 作者 | 年份 | 引用 | 对 AG 的价值 |
|---|------|------|------|------|-------------|
| 13 | **Adapting PLC/SCADA Systems To Mitigate Industrial IoT Cybersecurity Risks** | Tarek & Hasan | 2024 | **21** | 工业控制系统中的 fail-closed 策略，deny rules + rate limits + 隔离点设计，AG 的 M4 interlock 继电器控制回路可直接引用 |
| 14 | **FaaSGuard: Secure CI/CD for Serverless Applications** | Barrak et al. | 2025 | **4** | 将 fail-closed 安全检查嵌入 CI/CD 每个阶段，AG 可将类似思想用于部署包验证（install/upgrade/rollback） |
| 15 | **From promise to peril: rethinking red and blue teaming in the age of LLMs** | Abuadbba et al. | 2026 | **17** | LLM 安全中的 fail-closed 场景，AG 的 7 层 AI Agent 检测管线中的 L5 辩论层可引用 |
| 16 | **API Gateway Threat Prevention in Large-Scale Applications** | Hariharan | 2024 | **2** | API 网关的 fail-open vs fail-closed 策略，AG 的 Fastpath 网关和 Gateway Daemon 的 nftables 规则设计参考 |
| 17 | **Cradle-to-Grave Device Lifecycle Management for Cyber-Physical Systems** | Alagappan | 2026 | **0** | 网络物理系统的全生命周期信任管理，AG Appliance 从 provision 到退役的设备生命周期管理 |
| 18 | **Secure Fog-Cloud of Things** | Alli et al. | 2021 | **0** | "fail closed" 物理安全机制，AG 的硬件级隔离概念在 IoT 场景中的学术对应 |

**建议引用场景**：固件设计文档（fail-closed 状态机）、安全控制流不变量文档、产品 PRD 的"物理隔离"章节。

---

### 1.4 勒索软件与应急响应（Ransomware / Incident Response）

| # | 标题 | 作者 | 年份 | 引用 | 对 AG 的价值 |
|---|------|------|------|------|-------------|
| 19 | **Ransomware recovery and imaging operations: lessons learned** | Chen et al. | 2021 | **44** | 勒索软件应急响应中"快速断开网络"的实战经验，AG 的核心价值场景——**为什么需要远程物理隔离** |
| 20 | **Ransomware attacks on critical infrastructure: Colonial Pipeline incident** | Bellamkonda | 2024 | **14** | Colonial Pipeline 事件分析，**31 个地理分布点的战略断开**，AG 的分布式 Appliance 部署场景直接对应 |
| 21 | **Ransomware Resilience in Cloud and Enterprise Systems** | Jadala | 2025 | **18** | 勒索软件检测、响应、恢复框架，AG 的 Final Defense Mode 可作为该框架的"物理隔离层" |
| 22 | **Cybersecurity and Resilience of Smart Grids** | Jorgensen & Ma | 2026 | **17** | 智能电网中"不能简单断开系统"的困境，AG 的**可恢复隔离**（isolated → released）恰好解决此痛点 |
| 23 | **Ransomware threat mitigation strategies for protecting critical infrastructure** | Kalinaki | 2024 | **19** | 关键基础设施勒索软件防护，IT/OT 物理隔离是核心策略，AG 的 IT/OT 隔离能力直接对应 |
| 24 | **Towards a data-driven recommender system for handling ransomware incidents** | Husak | 2021 | **19** | 数据驱动的勒索软件事件响应，AG 的审计归档 + 链式校验可为此类系统提供可信数据源 |
| 25 | **Ransomware as a public safety crisis** | Alanazi | 2026 | **0** | 勒索软件作为公共危机的社会法律框架，等保/关基合规的**合规论证**参考 |
| 26 | **When there is no Plan: DaVita Healthcare Ransomware Attack** | Ologunde | 2025 | **0** | 医疗行业勒索软件响应失败分析，AG 的"预置物理隔离"可避免"无计划断开"的混乱 |

**建议引用场景**：产品路演 PPT（勒索软件案例）、客户价值主张（为什么需要物理隔离）、合规文档（关基保护要求）。

**特别推荐**：Chen et al. (2021, 44 citations) 和 Bellamkonda (2024, 14 citations) 是 AG 路演中最有力的学术背书——**"学术界已公认物理隔离是勒索软件响应的首要措施"**。

---

### 1.5 关键基础设施保护（Critical Infrastructure Protection）

| # | 标题 | 作者 | 年份 | 引用 | 对 AG 的价值 |
|---|------|------|------|------|-------------|
| 27 | **Advances in Security Maturity and Architecture Design in Critical Infrastructures** | Avila & Belesaca | 2025 | **0** | 关键基础设施安全成熟度框架，AG 可作为"Level 5 - 物理隔离"的落地工具 |
| 28 | **Critical Infrastructure Cybersecurity and the Future of Industrial Systems Protection** | Nyikes | 2024 | **0** | 网络分段是保护工业系统的关键，AG 的 Appliance 可作为网络分段的物理执行层 |
| 29 | **Cybersecurity Frameworks for Critical Infrastructure Protection** | Rao & Islam | 2026 | **0** | 多层防御 + AI + 零信任架构，AG 的位置在"第 N 层 - 物理兜底" |
| 30 | **A LAYERED RESILIENCE FRAMEWORK FOR SECURING CRITICAL INFRASTRUCTURE** | Jalolov | 2026 | **0** | OT/IoT/IT 分区模型 + 零信任访问，AG 的 SERVER/LAN/WAN/MGMT 三平面分离可直接对应 |
| 31 | **Trust for Critical Power Infrastructure** | Mittal & Ghosh | 2025 | **0** | 电力关基的网络分段与策略应用，AG 在电力行业的场景化论证 |
| 32 | **Cybersecurity in Critical Infrastructure** | Hasabnis | 2025 | **0** | IT/OT 融合、遗留系统、入侵检测、区块链，AG 在遗留系统改造中的部署方案参考 |

**建议引用场景**：行业白皮书（电力、金融、医疗）、关基保护合规文档、政府/行业标书。

---

### 1.6 零信任与微分段（Zero Trust / Microsegmentation）

| # | 标题 | 作者 | 年份 | 引用 | 对 AG 的价值 |
|---|------|------|------|------|-------------|
| 33 | **Zero trust implementation for legacy systems using dynamic microsegmentation** | Bello et al. | 2025 | **23** | 遗留系统的零信任微分段实现，AG 作为遗留基础设施的"外挂式物理隔离"可直接引用 |
| 34 | **Zero-trust network access (ZTNA)** | Mavroudis | 2024 | **17** | ZTNA 架构综述，AG 的 Final Defense 可视为 ZTNA 的"物理访问层"——默认不信任，硬件授权后才释放 |
| 35 | **A three-tier microsegmentation framework for enterprise networks** | Hari et al. | 2026 | **2** | 企业网络微分段框架，AG 的分布式 Agent + Appliance 部署可作为"Tier 3 - 工作负载级隔离" |
| 36 | **IMPLEMENTING ZERO-TRUST TO MITIGATE INSIDER THREATS** | Rautaray | 2025 | **19** | 零信任防御内部威胁，AG 的"即使 root 也无法恢复网络"直接对应内部威胁/凭证泄露场景 |
| 37 | **Modern defense paradigms: Zero Trust, network segmentation, micro-segmentation** | Bondhala | 2025 | **5** | 零信任 + 网络分段 + 微分段，威胁检测能力提升 38%，AG 可作为"检测后隔离执行层" |
| 38 | **Effectiveness of Continuous Verification and Micro-Segmentation** | Rhoads & Smith | 2024 | **3** | 持续验证 + 微分段，AG 的周期性 heartbeat + bridge state 上报就是"持续验证"的物理实现 |
| 39 | **Understanding zero trust architecture** | Ok et al. | 2025 | **3** | 零信任架构入门，IAM + 微分段 + 设备安全，AG 在零信任生态中的定位参考 |
| 40 | **Implementing Micro-Segmentation in Cloud Architectures** | Reddy | 2025 | **2** | 云架构微分段，AG 的云原生部署（K8s DaemonSet）与微分段的结合方案 |

**建议引用场景**：零信任架构文档、与 Gartner/Forrester 的分析师沟通、企业级销售材料（"AG 是零信任的最后一公里"）。

---

### 1.7 AI 驱动的威胁检测（AI-Driven Threat Detection）

| # | 标题 | 作者 | 年份 | 引用 | 对 AG 的价值 |
|---|------|------|------|------|-------------|
| 41 | **AI-based anomaly detection for real-time cybersecurity** | Goswami | 2024 | **99** | AI 异常检测综述，**高引用（99）**，AG 检测管线（0% FPR 约束）的学术基础 |
| 42 | **AI-driven forensic systems for real-time anomaly detection** | Ndibe | 2025 | **63** | AI 取证 + 实时异常检测，AG 审计归档 + 实时检测的双重价值 |
| 43 | **AI-driven cybersecurity: Advancing intelligent threat detection** | Sunkara | 2022 | **64** | AI 网络安全综述，威胁识别 + 自适应防御，AG 7 层 AI Agent 的顶层框架 |
| 44 | **AI-driven anomaly detection for securing IoT devices in 5G smart cities** | Reis | 2025 | **54** | IoT 5G 场景 AI 检测，AG 在边缘/IoT 场景的扩展可能性 |
| 45 | **Enhancing network security with AI-driven intrusion detection** | Goswami | 2024 | **34** | AI 入侵检测系统，AG 检测管线（规则 + AI 升级）的学术对应 |
| 46 | **AI-driven threat detection: Enhancing cloud security with generative models** | Vadisetty et al. | 2023 | **34** | 生成式模型用于云安全威胁检测，AG 未来可考虑生成式 AI 在检测管线中的应用 |
| 47 | **AI-driven approaches to cyber security: ML algorithms for threat prediction** | Raza et al. | 2024 | **28** | 1D-CNN + 异常检测，AG 检测引擎可借鉴的模型架构 |
| 48 | **AI-Driven Threat Detection in Cybersecurity** | Madupati | 2024 | **23** | 高级持续威胁检测，Explainable AI (XAI)，AG 检测管线需要可解释性以满足合规审计 |
| 49 | **The role of AI and ML in cybersecurity** | Bello et al. | 2025 | **12** | AI/ML 在网络安全中的角色，威胁检测 + 异常检测 + 自动响应，AG 全链路映射 |

**建议引用场景**：AI 检测管线技术文档、7 层 Agent 架构白皮书、数据集评估报告（引用"0% FPR"约束的学术基础）。

---

### 1.8 重放攻击与单调计数器（Replay Attack / Monotonic Counter）

| # | 标题 | 作者 | 年份 | 引用 | 对 AG 的价值 |
|---|------|------|------|------|-------------|
| 50 | **Hardware assisted smart grid authentication** | Ebrahimabadi & Younis | 2021 | **11** | 硬件辅助认证 + 单调计数器防重放，**直接支撑 AG 的 monotonic counter 设计** |
| 51 | **Secure Biometric Authentication for Resource-Constrained IoT Devices** | Kupcova et al. | 2026 | **0** | 单调递增计数器防重放，硬件安全机制保护，AG 的 counter 防回滚 + SE 存储的学术基础 |
| 52 | **HN-Sec: A lightweight hash and nonce-based security mechanism for RPL** | Sanshi | 2025 | **0** | 轻量级 nonce 防重放，AG 的 challenge 16 槽环形去重机制的简化参考 |
| 53 | **An Examination of LPWAN Security in Maritime Applications** | Larkin & Easttom | 2026 | **1** | 低功耗广域网安全，资源受限环境下的安全通信，AG 的 serial JSON 轻量协议场景 |

**建议引用场景**：固件安全设计文档（controller_tasks.c 中的 counter 校验逻辑）、硬件授权服务代码注释、专利申请（monotonic counter + policyDigest 绑定）。

**特别推荐**：Ebrahimabadi & Younis (2021, 11 citations) 是 AG monotonic counter 机制最直接的学术支撑——**"硬件指纹 + 单调计数器 = 防重放攻击"**。

---

## 二、按 AetherGuard 模块映射的文献速查表

| AG 模块 | 对应主题 | 推荐论文编号 | 核心引用 |
|---------|---------|-------------|---------|
| **M1 Gateway Daemon** | 零信任/微分段 | 33-40 | Bello et al. (2025, 23) |
| **M2 STM32 控制器** | 安全启动/信任根 | 9-12 | Siddiqui et al. (2020, 14) |
| **M3 Secure Element** | 远程证明/TPM | 1-8 | Narayanan et al. (2023, 57) |
| **M4 Interlock** | Fail-closed/工控安全 | 13-18 | Tarek & Hasan (2024, 21) |
| **Final Defense 控制回路** | 重放攻击/单调计数器 | 50-53 | Ebrahimabadi & Younis (2021, 11) |
| **检测管线 / AI Agent** | AI 威胁检测 | 41-49 | Goswami (2024, 99) |
| **审计归档** | 勒索软件响应 | 19-26 | Chen et al. (2021, 44) |
| **市场定位/合规** | 关基保护 | 27-32 | Jalolov (2026) |
| **部署架构** | 零信任/微分段 | 33-40 | Mavroudis (2024, 17) |

---

## 三、使用建议

### 3.1 产品白皮书引用

建议在以下章节引用对应文献：

- **"信任根与远程证明"** → 引用 Narayanan et al. (2023), Siddiqui et al. (2020), RFC 9684
- **"Fail-Closed 安全架构"** → 引用 Tarek & Hasan (2024), Barrak et al. (2025)
- **"AI 智能检测"** → 引用 Goswami (2024), Sunkara (2022), Ndibe (2025)
- **"物理隔离价值"** → 引用 Chen et al. (2021), Bellamkonda (2024), Jorgensen & Ma (2026)
- **"零信任架构"** → 引用 Mavroudis (2024), Bello et al. (2025)

### 3.2 专利申请引用

- **"硬件 grant 签名 + monotonic counter"** → 引用 Ebrahimabadi & Younis (2021), RFC 9684
- **"跨服务 policyDigest 绑定"** → 引用 Wagner et al. (2024) 的 DDS 安全证明方案
- **"固件度量启动 + 安全更新"** → 引用 Usman et al. (2026), Siddiqui et al. (2020)

### 3.3 学术合作方向

| 潜在合作方向 | 对应学者 | 合作切入点 |
|-------------|---------|-----------|
| 远程证明协议优化 | Narayanan (2023) | 将 vTPM 证明扩展到 STM32 + OPTIGA 场景 |
| 工控安全 fail-closed | Tarek & Hasan (2024) | 将 PLC/SCADA 的 fail-closed 策略迁移到 IT 服务器 |
| AI 检测 0% FPR 约束 | Goswami (2024) | 联合发表论文，验证 AG 数据集在正常流量上的 0% FPR |
| 零信任微分段 | Bello et al. (2025) | 将 AG 作为遗留系统零信任的"物理隔离插件" |
| 勒索软件响应 | Chen et al. (2021) | 联合案例研究，验证 AG 在真实勒索软件演练中的隔离效果 |

---

## 四、数据文件清单

所有原始搜索结果已保存为 CSV，可进一步分析：

| 文件 | 主题 | 论文数 |
|------|------|--------|
| `refs_secure_element.csv` | Secure Element / TPM / 远程证明 | 8 |
| `refs_root_trust.csv` | 硬件信任根 / 安全启动 | 4 |
| `refs_fail_closed.csv` | Fail-Closed / 网络物理安全 | 8 |
| `refs_ransomware.csv` | 勒索软件 / 应急响应 | 10 |
| `refs_critical_infra.csv` | 关键基础设施保护 | 7 |
| `refs_zero_trust.csv` | 零信任 / 微分段 | 9 |
| `refs_ai_detection.csv` | AI 驱动的威胁检测 | 9 |
| `refs_monotonic.csv` | 重放攻击 / 单调计数器 | 4 |

---

*文献搜索日期：2026-07-15*<br>
*数据来源：Google Scholar*<br>
*搜索范围：2020-2026，英文优先*<br>
*总论文数：59 篇，筛选后推荐 53 篇*
