# AetherGuard - 技术架构与功能实施手册

**密级**: 内部技术文档
**版本**: v1.0.0
**日期**: 2026-01-24
**作者**: 技术研发部

---

## 1. 系统综述

AetherGuard 是下一代**服务器安全防御平台**，旨在解决传统 WAF 无法防御的业务逻辑攻击与内部威胁。系统采用 "Agent-Hub" 架构，通过驻留在业务服务器上的轻量级 Agent 实时采集流量与系统调用，上报至中心化 Hub 进行 AI 分析与决策。

### 核心架构图
```mermaid
graph TD
    User[外部流量] --> ELB
    ELB --> LinuxNode["业务服务器 (Linux)"]
    
    subgraph "Edge Node (单机)"
        LinuxNode -- Hook --> Agent[AetherGuard Agent]
        Agent -- 采集 --> Metrics[系统指标]
        Agent -- 采集 --> Traffic[HTTP流量]
        Agent -- 执行 --> Firewall[IPTables阻断]
    end
    
    subgraph "Control Plane (集群)"
        Agent --> |gRPC/WS| Hub[管控中心]
        Hub --> AI[多模型分析引擎]
        Hub --> DB[(时序数据库)]
        
        Dashboard[可视化控制台] -- Read --> Hub
    end
```

---

## 2. 功能模块详解

### 2.1 全局态势感知 (Dashboard)
**功能**: 提供上帝视角的安全监控，展示系统的整体健康度与实时攻防状态。
**实现原理**: 
- 前端通过 WebSocket 订阅 `/topic/dashboard`。
- 后端 Redis 聚合每秒的 QPS、拦截数、活跃 Agent 数。
- **Screenshot Ref**: `dashboard.png`

![Dashboard](assets/dashboard.png)

### 2.2 智能 Agent 集群 (Agents)
**功能**: 分布式节点的注册、心跳保活与指令下发。
**实现原理**:
- 采用双向心跳机制 (Heartbeat Interval: 30s)。
- Agent 支持自升级与配置热加载。
- 状态机管理: Online / Offline / Warning / Critical (资源过载)。
- **Screenshot Ref**: `agents.png`

![Agents](assets/agents.png)

### 2.3 硬件化部署与运维 (Devices)
**功能**: 纳管 ESP32 部署工具 (Deployment Dongle)。
**实现原理**:
- 当前 v1 硬件为 **面包板跳线版 USB-TTL 串口部署器原型**，ESP32 通过本地串口与目标主机交互。
- 原型使用 1 个外部 CP2102，在“烧录/调试”与“部署”两种模式之间切换，不做双桥并存设计。
- 固件在本地屏幕和按键上完成环境检测、备份、安装确认和高风险卸载确认。
- 后端 `/ws/device`、OTA 与 physical confirmation 仍保留为实验性云设备网关与模拟链路，不属于当前串口部署器固件能力。
- **Screenshot Ref**: `devices.png`

![Devices](assets/devices.png)

### 2.4 主动与被动扫描 (Scanner & Sites)
**功能**: 结合 Nuclei 的主动漏洞探测与基于流量的被动分析。
**实现原理**:
- **被动**: Agent 镜像流量 -> 正则/AI 匹配 (SQLi, XSS)。
- **主动**: 任务调度器定期下发 Nuclei 扫描任务 -> Agent 执行 -> 回传 JSON 报告。
- **Screenshot Ref**: `sites.png`, `scanner.png`

![Sites](assets/sites.png)
![Scanner](assets/scanner.png)

### 2.5 自动化部署向导 (Deployment)
**功能**: 降低 Agent 接入门槛。
**实现**:
- 动态生成带 Token 的 Install Script (Curl | Bash)。
- 自动检测 OS 类型 (Ubuntu/CentOS) 并适配安装命令。
- **Screenshot Ref**: `deploy.png`

![Deployment](assets/deploy.png)

### 2.6 AI 决策大脑 (Settings - AI Endpoint)
**功能**: 配置威胁分析引擎。
**技术细节**:
- 支持模型热切换: Local Ollama (Phi-3/Llama3) vs Cloud API (DeepSeek/GPT-4)。
- **Privacy Mode**: 开启后，仅在本机进行 Embedding，只有脱敏的 Vector 向量会被发送到云端（如果需要）。
- **Screenshot Ref**: `settings.png`

![Settings](assets/settings.png)

### 2.7 日志与审计 (History & Alerts)
**功能**: 满足企业合规性需求 (Compliance)。
**实现**:
- 不可篡改的日志存储 (Write-Once)。
- 告警风暴抑制算法 (Debounce)，防止同一 IP 触发海量告警。
- **Screenshot Ref**: `history.png`, `alerts.png`

![History](assets/history.png)
![Alerts](assets/alerts.png)

---

## 3. 硬件接口协议 (ESP32)

### 通信协议
- **物理层**: USB-TTL (Serial 115200 8N1)
- **部署模式**: 本地串口部署器，Linux 主机通过预装 serial helper 执行安装/卸载，Windows 仅做环境识别。
- **原型切换规则**:
  - 烧录/调试优先使用开发板板载 USB
  - 若板载 USB 不可用，外部 CP2102 可临时接 `GPIO3/1/GND` 进行烧录
  - 进入部署模式前必须断电，再把外部 CP2102 改接到 `GPIO16/17/GND`
  - 部署模式下 CP2102 不连接 `VCC/5V/3V3`
- **协议层**: allow-list 请求 + 显式串口标记协议
  - 请求阶段: `AG:REQ:ENV`, `AG:REQ:BACKUP`, `AG:REQ:INSTALL`, `AG:REQ:REMOVE`
  - 运行阶段: `AG:BEGIN:<action>`, `AG:STEP:<action>:RUN`
  - 环境识别: `AG:ENV:LINUX`, `AG:ENV:WINDOWS`
  - 备份结果: `AG:OK:BACKUP`, `AG:ERR:BACKUP:<code>`
  - 安装结果: `AG:OK:INSTALL`, `AG:ERR:INSTALL:<code>`
  - 卸载结果: `AG:OK:REMOVE`, `AG:ERR:REMOVE:<code>`

### 引脚基线
- **按键**: `BTN_OK=GPIO18`, `BTN_NEXT=GPIO19`, `BTN_BACK=GPIO23`
- **I2C OLED**: `SDA=GPIO21`, `SCL=GPIO22`
- **目标串口**: `RX=GPIO16`, `TX=GPIO17`
- **指示与提示**: `RGB=GPIO25/26/27`, `BUZZER=GPIO14 (active-low module)`

### 安全机制
- **Boot-safe GPIO**: 三颗按键已避开启动配置脚，防止按键按住上电时误入异常启动模式。
- **Single-Bridge Rule**: 外部 CP2102 同一时刻只能承担一种角色，任何重新接线必须在断电状态下完成。
- **Hard Confirmation**: 涉及 `rm -rf` 等指令时，ESP32 固件逻辑强制拦截，等待本地 `BTN_OK (GPIO18)` 按下确认后才放行。

---
**Technical Department @ AetherGuard**
