# AetherGuard 项目学术介绍文档

## 目的



---

## 一、项目概述

### 1.1 项目名称

**AetherGuard** - 基于多智能体辩论架构的分布式服务器安全防御平台

### 1.2 核心问题

传统网络安全防御系统（如 WAF、IDS）存在以下问题：
- **黑盒决策**：单模型 AI 系统无法解释决策过程
- **边界防御局限**：无法感知应用层上下文，误报率高
- **缺乏自适应能力**：难以从攻击中学习和进化

### 1.3 解决方案

AetherGuard 提出了一种 **"中心化控制 + 分布式执行"** 的混合架构：
- 在服务器内部署 Agent，直接感知应用层流量
- 使用 **7 层多智能体辩论架构** 实现可解释的安全决策
- 支持本地/云端异构 AI 模型，兼顾隐私与能力

---

## 二、核心创新点

### 2.1 七层多智能体辩论架构（核心学术贡献）

| 层级 | 名称 | 功能 | 输出 |
|------|------|------|------|
| L1 | 协作层 | 威胁分类与专家路由 | 分配的专家集合 |
| L2 | 角色扮演层 | Socrates(红队)、Plato(蓝队)、Aristotle(分析师) | 变异体、模式验证、异常分数 |
| L3 | 场景遍历层 | 分布式追踪与攻击叙事 | 时间线、攻击链 |
| L4 | 能力层 | 沙箱工具执行 | 工具执行结果 |
| L5 | 辩论层 | 多角色论证与仲裁 | 辩论会话记录 |
| L6 | 异构模型层 | 本地/云端模型路由 | 路由决策 |
| L7 | 综合层 | 案例文件生成与策略进化 | 案例文件、策略建议 |

**创新意义**：
- 将安全决策过程从"黑盒分类"转变为"结构化辩论"
- 冲突分析被外化为显式的辩论会话，而非隐藏在单一分类器输出中
- 生成可审计的案例文件，支持安全运营的合规要求

### 2.2 角色智能体系统（L2 层）

受哲学启发设计的三角色智能体：

| 角色 | 哲学理念 | 职责 | 输出 |
|------|----------|------|------|
| **Socrates** (红队) | "质疑一切" | SQL注入、XSS、命令注入检测；生成攻击变体 | 攻击变异体列表 |
| **Plato** (蓝队) | "未经审视的请求不值得处理" | 模式验证、合规检查、白名单匹配 | 验证结果、违规列表 |
| **Aristotle** (分析师) | "我们是我们反复做的事" | 异常检测、行为分析、统计分析 | 异常分数(0-1)、行为画像 |

### 2.3 辩论协议（L5 层）

当智能体意见不一致时触发辩论：
- **触发条件**：角色分歧、置信度差异超过阈值、输出分歧过大
- **辩论流程**：最多 3 轮，每轮一个角色发言
- **仲裁机制**：多数投票 + 聚合分布 + 硬证据计数
- **裁决逻辑**：
  - 恶意判定：恶意票数 ≥ 2 或聚合恶意概率 ≥ 0.58 或硬证据 ≥ 2
  - 安全判定：安全票数占多数且无恶意票
  - 需复核：后验概率仍模糊

### 2.4 异构模型路由（L6 层）

支持多种 AI 部署模式：
- **本地模式**：Ollama/Llama3（隐私优先）
- **云端模式**：智谱/GLM-4（能力优先）
- **混合模式**：本地优先，云端兜底
- **隐私保护**：自动脱敏（IP、邮箱、Token）后再发送云端

---

## 三、系统架构

### 3.1 高层架构

```
控制平面 (云端/本地部署)
├── Backend API (Node.js/TypeScript)
├── PostgreSQL/SQLite 数据库
├── Redis (消息队列 + 缓存)
├── WebSocket 网关 (AgentGateway, DeviceGateway)
├── Rust Fastpath (高性能流量处理)
└── MinIO (S3 兼容存储)

分布式 Agent (边缘端)
├── Node.js Agent 进程
│   ├── 流量监控器
│   ├── 攻击检测器
│   ├── 防火墙控制器
│   └── 日志收集器
└── ESP32 部署 Dongle (硬件)

前端仪表板
└── React SPA + Vite + TailwindCSS + Recharts
```

### 3.2 关键技术特性

| 特性 | 实现 |
|------|------|
| **高性能处理** | Rust Fastpath sidecar，64 分片速率限制，编译期正则 |
| **实时通信** | 双向 WebSocket，JWT + API Key 双重认证 |
| **命令安全** | HMAC-SHA256 签名，Nonce 防重放 |
| **审计日志** | 防篡改签名，PostgreSQL + SQLite 双写 |
| **速率限制** | 多维度限制，IP 欺骗检测，Fail-Closed 策略 |

---

## 四、技术深度体现

### 4.1 安全工程实践

代码中记录并修复了多个 CVE 级别的安全问题：

| CVE 编号 | 问题 | 修复方案 |
|----------|------|----------|
| CVE-2026-013/019/020 | Unicode 绕过 | Unicode 规范化处理 |
| CVE-2026-100/101 | 主机名验证/竞态条件 | 事务保护 + 验证 |
| CVE-2026-200 | 日志敏感信息泄露 | 自动脱敏 |
| CVE-2026-300/301 | 速率限制绕过 | 多级速率限制 |
| CVE-2026-032/033 | 设备网关 CORS | 严格的 CORS 配置 |

### 4.2 测试覆盖

- **单元测试**：28+ 测试文件
- **E2E 测试**：Playwright 端到端测试
- **安全测试**：专门的漏洞验证测试套件
- **攻击检测测试**：SQL注入、XSS、路径遍历、命令注入检测测试

### 4.3 性能指标

| 指标 | 数值 |
|------|------|
| 基准吞吐量 | 1329.79 QPS |
| P95 延迟 | 21ms |
| Rust Fastpath 处理 | 微秒级 |
| 速率限制分片 | 64 路并行 |

---

## 五、研究贡献总结

### 5.1 主要贡献

1. **多智能体辩论机制**：用于安全决策冲突解决的结构化辩论流程
2. **异构模型路由**：隐私感知的本地/云端模型切换
3. **案例文件综合**：可审计的安全运营记录生成
4. **分布式 Agent 架构**：加密命令签名的边缘安全执行
5. **硬件-软件集成**：ESP32 部署 Dongle 的物理层安全操作

### 5.2 诚实的局限性（已在论文中声明）

- 大规模基准验证待完成
- 本地模型评估不完整（测试期间 Ollama 不可用）
- 尚未进行辩论层收益的消融研究
- ESP32 物理部署尚未大规模验证

---

## 六、推荐期刊方向

基于项目特点，建议考虑以下期刊类型：

### 6.1 网络安全/信息安全类

| 期刊 | 理由 |
|------|------|
| **IEEE Transactions on Information Forensics and Security** | 多智能体安全决策系统 |
| **Computers & Security** | 实践性安全系统实现 |
| **Journal of Information Security and Applications** | 分布式安全架构 |
| **IEEE Security & Privacy** | 可解释 AI 安全系统 |

### 6.2 人工智能/多智能体系统类

| 期刊 | 理由 |
|------|------|
| **Autonomous Agents and Multi-Agent Systems** | 7层多智能体架构 |
| **AI Magazine** | 哲学启发的角色智能体设计 |
| **International Journal of Intelligent Systems** | 异构模型路由 |

### 6.3 分布式系统/云计算类

| 期刊 | 理由 |
|------|------|
| **IEEE Transactions on Cloud Computing** | 边缘-云混合架构 |
| **Journal of Systems and Software** | 完整系统实现 |
| **Future Generation Computer Systems** | 分布式安全系统 |

---

## 七、关键文件索引

| 类别 | 文件路径 |
|------|----------|
| AI 系统主入口 | `backend/src/ai-agents/index.ts` |
| 核心类型定义 | `backend/src/ai-agents/core/types.ts` |
| 智能体编排器 | `backend/src/ai-agents/core/agent-orchestrator.ts` |
| 辩论协议 | `backend/src/ai-agents/debate/debate-protocol.ts` |
| 角色智能体 | `backend/src/ai-agents/roles/*.ts` |
| 模型路由器 | `backend/src/ai-agents/models/model-router.ts` |
| 学术论文草稿 | `docs/papers/2026-03-12-seven-layer-multi-agent-debate-sci-draft.md` |
| 安全架构文档 | `docs/reports/SECURITY_ARCHITECTURE.md` |
| 技术深度解析 | `docs/全栈技术深度解析.md` |
| 产品白皮书 | `docs/product_whitepaper.md` |

---

## 八、项目规模统计

| 指标 | 数量 |
|------|------|
| 后端 TypeScript 文件 | 100+ |
| 前端 React 组件 | 50+ |
| 测试文件 | 28+ |
| 文档文件 | 30+ |
| 支持的攻击检测类型 | 10+ |
| AI 模型提供商 | 3 (Ollama, 智谱, OpenAI) |
| 硬件平台 | ESP32-WROOM-32 |

---

## 九、结论

AetherGuard 是一个 **完整实现的** 分布式安全防御平台，其核心学术贡献在于：

1. **新颖的多智能体辩论架构** - 将安全决策从黑盒转变为可解释的结构化辩论
2. **跨领域技术集成** - 分布式系统、AI/ML、网络安全、嵌入式系统的有机结合
3. **生产级实现** - 不是纯理论研究，而是可部署的完整系统

项目的跨学科特性（AI + 安全 + 分布式系统）使其适合投稿到多个领域的期刊。建议根据论文侧重点选择合适的期刊方向。

---

## 附录：快速验证指南

### A.1 本地运行验证

```bash
# 克隆仓库后
docker-compose up -d --build

# 访问前端
open http://localhost:8080

# 默认登录
# 用户名: admin
# 密码: admin123
```

### A.2 AI 系统演示

```bash
cd backend
npm install
npm run demo:agents  # 运行 AI 多智能体系统演示
```

### A.3 关键代码位置

- **7层架构定义**: `backend/src/ai-agents/core/types.ts` - `SevenLayerArchitecture` 接口
- **辩论协议**: `backend/src/ai-agents/debate/debate-protocol.ts` - `DebateProtocol` 类
- **角色智能体**: `backend/src/ai-agents/roles/` - Socrates/Plato/Aristotle 实现
- **模型路由**: `backend/src/ai-agents/models/model-router.ts` - 本地/云端路由逻辑

---

*文档版本: 2026-03-13*
*项目仓库: github.com/[repo-path]*
