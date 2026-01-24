# FluxGuard 产品使用手册

## 1. 产品概述
FluxGuard 是下一代 API 安全中间件平台，集成实时流量监控、自动化漏洞扫描、智能威胁防御与可视化管理于一体。系统采用现代化微服务架构，支持 Docker 容器化部署，并内置 AI 驱动的错误分析引擎。

## 2. 核心功能模块

### 2.1 安全控制台 (Dashboard)
系统核心概览页面，提供实时安全态势感知。
![控制台概览](file:///C:/Users/Abraham/.gemini/antigravity/brain/8a174ab7-1d9f-4a1b-8ad6-30c93494558a/manual_dashboard_zh_1769233236090.png)
- **流量监控**：实时展示请求数、拦截威胁数及平均延迟。
- **威胁分布**：通过可视化图表展示当前系统的主要安全威胁（如 SQL 注入、XSS 等）。
- **实时日志流**：滚动展示最新的访问日志与安全拦截记录。

### 2.2 站点管理 (Site Management)
统一管理所有受保护的 API 站点与微服务。
![站点管理](file:///C:/Users/Abraham/.gemini/antigravity/brain/8a174ab7-1d9f-4a1b-8ad6-30c93494558a/manual_sites_zh_1769233247552.png)
- **多站点支持**：支持配置多个后端目标服务器。
- **状态监控**：实时显示各站点的健康状态（安全/警告/危险）。
- **一键防护**：可针对特定站点快速开启/关闭 SSL、防机器人等模块。

### 2.3 部署向导 (Deployment Wizard)
可视化的 Nginx/中间件配置生成工具。
![部署向导](C:/Users/Abraham/.gemini/antigravity/brain/d91e4ebe-2483-405f-a069-c2dcd073e3d8/manual_deployment_cn_1769184578310.png)
- **中间件选择**：支持 Nginx, Apache, Caddy 等主流服务器。
- **参数配置**：图形化设置监听端口、服务器名称及速率限制阈值。
- **一键生成**：自动生成经过安全加固的配置文件，支持下载或复制。

### 2.4 安全配置扫描器 (Security Scanner)
自动化的安全基线检查工具。
![安全扫描](C:/Users/Abraham/.gemini/antigravity/brain/d91e4ebe-2483-405f-a069-c2dcd073e3d8/manual_scanner_cn_1769184597898.png)
- **全面扫描**：检查 SSL 配置、HTTP 安全头、端口暴露等风险。
- **即时报告**：扫描完成后立即生成包含漏洞等级与修复建议的报告。
- **进度可视化**：动态展示扫描进度与当前检测项目。

### 2.5 警报中心 (Alerts)
集中的安全事件与系统异常通知中心。
![警报中心](file:///C:/Users/Abraham/.gemini/antigravity/brain/8a174ab7-1d9f-4a1b-8ad6-30c93494558a/dashboard_chinese_threat_notification_1769233646461.png)
- **分级告警**：按严重、高危、中等、低危对警报进行分类。
- **上下文关联**：警报详情包含攻击源 IP、攻击类型（如 SQL 注入）及相关防护规则 ID。
- **状态管理**：支持对警报进行确认、处理与关闭操作。

### 2.6 超级管理员控制台 (Super Admin)
系统级监控与密钥管理平台。
![管理员控制台](C:/Users/Abraham/.gemini/antigravity/brain/d91e4ebe-2483-405f-a069-c2dcd073e3d8/manual_admin_cn_1769184653165.png)
- **API 密钥管理**：创建、查看与吊销系统的访问密钥 (API Keys)。
- **资源监控**：实时监控服务器 CPU、内存使用率。
- **性能开销分析**：精确量化安全中间件带来的延迟与计算开销，确保“低侵入性”。

### 2.7 审计日志 (Audit Logs)
记录系统内发生的所有重要变更与修复操作。
![审计日志](file:///C:/Users/Abraham/.gemini/antigravity/brain/8a174ab7-1d9f-4a1b-8ad6-30c93494558a/manual_logs_zh_1769233267109.png)
- **操作追溯**：记录谁（User ID）、在什么时间（Time）、做了什么操作。
- **合规审计**：满足企业安全审计需求。

### 2.8 系统设置 (Settings)
全局系统参数配置。
![系统设置](file:///C:/Users/Abraham/.gemini/antigravity/brain/8a174ab7-1d9f-4a1b-8ad6-30c93494558a/manual_settings_zh_1769233278712.png)
- **AI 模型配置**：设置用于日志分析的本地 LLM 模型参数。
- **通知渠道**：配置邮件、Slack 或 Webhook 告警通知。

---

## 3. 高级集成：AI 驱动的错误分析

FluxGuard 内置了基于本地大语言模型 (LLM) 的智能分析引擎 `Deployment AI Server`，可自动分析部署日志并提供修复建议。

### 3.1 AI 模型规格
- **模型名称**：`deepseek-coder:6.7b`
- **模型架构**：DeepSeek Coder 6.7B instruct
- **主要能力**：
    - **代码理解**：深度理解 Nginx 配置、Docker Compose 文件及 Python/Go 源码。
    - **错误诊断**：专门针对部署报错（如端口冲突、依赖缺失、权限不足）进行了优化。
    - **隐私安全**：完全本地运行（Localhost），无需上传日志到云端，确保敏感数据（密钥、IP）不外泄。

### 3.2 工作流程
1. **日志捕获**：系统自动捕获部署失败的错误日志。
2. **敏感脱敏**：内置 Regex 过滤器自动屏蔽 IP、Password 等敏感字段。
3. **本地推理**：将脱敏后的日志发送至本地运行的 DeepSeek 模型。
4. **生成方案**：AI 返回结构化的“原因分析”与“修复步骤”，直接展示在部署向导中。

---

## 4. 扩展工具：ESP32 硬件集成

FluxGuard 支持通过 ESP32 单片机扩展物理层面的可视化与控制能力，打造“软硬结合”的安全态势感知系统。

### 4.1 功能特性
- **物理状态指示灯**：通过 ESP32 连接 WS2812B 灯带，根据系统当前威胁等级（安全-绿 / 警告-黄 / 攻击-红）实时改变环境光颜色。
- **硬件紧急开关**：接入物理按钮，实现“一键断网”或“开启高防御模式”的物理熔断机制。
- **OLED 实时看板**：在 0.96寸 OLED 屏幕上实时显示当前 QPS、拦截总数与 CPU 温度。

### 4.2 接入方式
FluxGuard 后端提供标准的 WebSocket 接口，ESP32 可通过 WiFi 连接并订阅 `/ws/status` 频道，实时获取系统状态数据包并驱动外设动作。
