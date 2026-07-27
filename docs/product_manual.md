# AetherGuard 产品使用手册

## 1. 产品概述
AetherGuard 是下一代 API 安全中间件平台，集成实时流量监控、自动化漏洞扫描、智能威胁防御与可视化管理于一体。系统采用现代化微服务架构，支持 Docker 容器化部署，并内置 AI 驱动的错误分析引擎。

> Validation Note (2026-07-27): Use `docs/reports/software-validation-status-2026-07-27.md` for current software evidence and test failures. Keep Docker, Object Lock, notification and simulated device evidence tied to the dated 2026-03-08 report. Stable 100k QPS, live external integrations, cross-platform rollout, local-AI latency, agent resource targets and physical hardware are not validated by the current local software run.

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

AetherGuard 内置了基于本地大语言模型 (LLM) 的智能分析引擎 `Deployment AI Server`，可自动分析部署日志并提供修复建议。

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

## 4. 扩展工具：AetherGuard Root-Resistant Gateway Appliance

AetherGuard 当前提供的主硬件基线是 **AetherGuard Root-Resistant Gateway Appliance**（STM32H5/U5 + Secure Element + fail-closed interlock），用于在机房或现场对目标服务器执行本地化、可确认的 Agent 部署，并提供硬件级安全门控。

> **归档说明**：以下保留的 ESP32 USB-TTL 串口部署器说明属于 v1 原型阶段的归档（legacy）文档。ESP32 原型已不再作为生产硬件基线，仅供历史参考与早期验证回溯。

### 4.1 功能特性（Gateway Appliance）
- **一体化安全网关**：基于 STM32H5/U5 MCU，集成 Secure Element 和 fail-closed interlock，适合现场部署闭环验证与生产运行。
- **OLED 可视确认**：在屏幕上显示环境检测、备份、安装和卸载确认状态。
- **物理安全交互**：通过硬件按键完成安装选择、风险确认和失败回退，危险操作必须经过本地物理确认。
- **强制备份与物理确认**：安装前先执行服务器侧备份；卸载等高风险动作必须由本地按键确认。
- **状态指示反馈**：指示灯表示检测中、处理、完成、错误或高风险确认等状态。
- **非阻塞部署流程**：环境检测、备份、安装和卸载均以主机回包终态判定成败，部署期间界面持续可用。

### 4.2 归档：ESP32 原型接入方式（Legacy）

> 本节内容为 ESP32 v1 原型的归档说明，仅供参考。生产环境请使用 Gateway Appliance。

- **面包板跳线原型**：采用 ESP32 开发板、面包板、杜邦线和外接模块快速搭建，适合先完成部署闭环验证。
- **物理链路**：原型通过面包板接线，外部 CP2102 在部署模式下连接 `GPIO16/17/GND` 与目标主机通信，默认 115200 8N1。
- **模式切换**：优先使用开发板板载 USB 进行烧录与串口调试；若板载 USB 不可用，可临时把外部 CP2102 接到 `GPIO3/1/GND` 进行烧录。外部 CP2102 同一时刻只能承担一种角色，切换前必须断电。
- **主机侧前提**：Linux 主机必须预装 serial helper 服务，负责把固定 allow-list 请求映射到本地部署命令。
- **协议**：当前固件先发送 `AG:REQ:ENV`、`AG:REQ:BACKUP`、`AG:REQ:INSTALL`、`AG:REQ:REMOVE`，主机 helper 再返回 `AG:BEGIN:*`、`AG:STEP:*`、`AG:ENV:*`、`AG:OK:*`、`AG:ERR:*`。
- **本地输入引脚**：`BTN_OK=GPIO18`、`BTN_NEXT=GPIO19`、`BTN_BACK=GPIO23`，已避开 ESP32 启动配置脚。
- **供电约束**：所有外设默认从 ESP32 开发板 `3V3` 和 `GND` 取电；部署模式下外部 CP2102 只接 `TXD/RXD/GND`，不向 ESP32 反灌电源。
- **限制**：当前 v1 固件仅对 Linux 主机执行部署/卸载；Windows 仅做环境识别，不执行安装。

> 仓库中的 `/ws/device`、OTA 和 physical-confirmation smoke 属于后端模拟链路与后续联网设备实验，不是当前串口部署器固件能力。
