# AetherGuard - 攻击面图谱 (Attack Surface Mapping)

**生成日期**: 2026-02-16
**目标系统**: AetherGuard v2.0.0
**架构类型**: 微服务 + WebSocket + Agent 模型

---

## 网络架构概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         外部攻击面                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐           │
│  │   浏览器客户端  │    │  Agent节点   │    │  Gateway设备   │           │
│  │  (React SPA) │    │ (Node.js)    │    │ (IoT Dongle) │           │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘           │
│         │                   │                   │                    │
│         └───────────────────┼───────────────────┘                    │
│                             ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Nginx/Caddy (可选)                        │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                             │                                        │
│                             ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              AetherGuard 后端 (Node.js:3005)                   │    │
│  │  ┌───────────────────────────────────────────────────────┐  │    │
│  │  │                    Express.js                          │  │    │
│  │  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐  │  │    │
│  │  │  │ REST API    │ │ WebSocket   │ │  中间件层        │  │  │    │
│  │  │  │ /api/*      │ │ Socket.IO   │ │  - Auth          │  │    │
│  │  │  └─────────────┘ └─────────────┘ │  - Rate Limit    │  │    │
│  │  │                                  │  - CORS          │  │    │
│  │  │                                  └─────────────────┘  │    │
│  │  └───────────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                             │                                        │
│                             ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                      数据层                                    │    │
│  │  ┌────────────┐  ┌────────────┐  ┌──────────────────┐       │    │
│  │  │ SQLite DB  │  │   Redis    │  │  文件系统         │       │    │
│  │  │ (持久化)   │  │  (缓存)    │  │  (配置/日志)      │       │    │
│  │  └────────────┘  └────────────┘  └──────────────────┘       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 公开 API 端点 (REST)

### 认证相关 (`/api/auth/*`)

| 端点 | 方法 | 认证要求 | 风险等级 | 描述 |
|------|------|---------|---------|------|
| `/api/auth/register` | POST | 否 | 🟡 中 | 用户注册 - 可能被滥用创建账户 |
| `/api/auth/login` | POST | 否 | 🟠 高 | 用户登录 - 暴力破解风险 |
| `/api/auth/refresh` | POST | 否 | 🟠 高 | Token 刷新 - Session Fixation |
| `/api/auth/me` | GET | 是 | 🟢 低 | 获取当前用户信息 |
| `/api/auth/logout` | POST | 是 | 🟢 低 | 用户登出 |
| `/api/auth/password` | PUT | 是 | 🟡 中 | 修改密码 |

### Agent 管理 (`/api/agents/*`)

| 端点 | 方法 | 认证要求 | 风险等级 | 描述 |
|------|------|---------|---------|------|
| `/api/agents` | GET | 是 | 🟢 低 | 列出所有 Agent |
| `/api/agents/:id` | GET | 是 | 🟡 中 | 获取 Agent 详情 - 信息泄露 |
| `/api/agents/:id/block` | POST | Admin | 🔴 严重 | 封禁 IP - 命令注入风险 |
| `/api/agents/:id/unblock` | POST | Admin | 🔴 严重 | 解封 IP - 命令注入风险 |
| `/api/agents/:id/scan` | POST | Admin | 🟠 高 | 触发扫描 - 可能被滥用 |

### 设备管理 (`/api/devices/*`)

| 端点 | 方法 | 认证要求 | 风险等级 | 描述 |
|------|------|---------|---------|------|
| `/api/devices` | GET | 是 | 🟢 低 | 列出所有设备 |
| `/api/devices/:id` | GET | 是 | 🟡 中 | 获取设备详情 |
| `/api/devices/:id/cmd` | POST | Admin | 🟠 高 | 发送命令到设备 |
| `/api/devices/:id` | DELETE | Admin | 🟠 高 | 删除设备 |
| `/api/devices/codebook` | GET | 是 | 🟢 低 | 获取密码本 |
| `/api/devices/codebook` | POST | 是 | 🟡 中 | 更新密码本 |

### 扫描器 (`/api/scanner/*`)

| 端点 | 方法 | 认证要求 | 风险等级 | 描述 |
|------|------|---------|---------|------|
| `/api/scanner/tasks` | POST | Admin | 🟠 高 | 创建扫描任务 - SSRF 风险 |
| `/api/scanner/tasks/:id` | GET | 是 | 🟢 低 | 获取任务状态 |
| `/api/scanner/tasks/:id/results` | GET | 是 | 🟡 中 | 获取扫描结果 |
| `/api/scanner/tasks/:id/cancel` | POST | 是 | 🟡 中 | 取消任务 |

### 部署管理 (`/api/deployments/*`)

| 端点 | 方法 | 认证要求 | 风险等级 | 描述 |
|------|------|---------|---------|------|
| `/api/deployments/generate` | POST | Admin | 🟡 中 | 生成部署配置 |
| `/api/deployments/save` | POST | Admin | 🟡 中 | 保存部署配置 |
| `/api/deployments/:id/download` | GET | Admin | 🟠 高 | 下载配置 - 路径遍历风险 |
| `/api/deployments/history/list` | GET | Admin | 🟢 低 | 获取历史记录 |

### 管理员 (`/api/admin/*`)

| 端点 | 方法 | 认证要求 | 风险等级 | 描述 |
|------|------|---------|---------|------|
| `/api/admin/errors` | GET | Admin | 🟡 中 | 获取错误日志 - 信息泄露 |
| `/api/admin/performance` | GET | Admin | 🟡 中 | 获取性能数据 |
| `/api/admin/logs` | POST | Admin | 🟡 中 | 提交日志 |
| `/api/admin/api-keys` | GET | Admin | 🟠 高 | 列出 API 密钥 |
| `/api/admin/api-keys` | POST | Admin | 🟠 高 | 创建 API 密钥 |
| `/api/admin/api-keys/:id` | DELETE | Admin | 🟠 高 | 删除 API 密钥 |

### Agent 入职 (`/api/agent-onboarding/*`)

| 端点 | 方法 | 认证要求 | 风险等级 | 描述 |
|------|------|---------|---------|------|
| `/api/agent-onboarding/codes` | POST | Admin | 🟠 高 | 创建入职代码 |
| `/api/agent-onboarding/exchange` | POST | 否 | 🟠 高 | 交换代码获取凭证 |
| `/api/agent-onboarding/agents` | GET | Admin | 🟡 中 | 列出已注册 Agent |
| `/api/agent-onboarding/revoke/:id` | POST | Admin | 🟠 高 | 撤销 Agent 凭证 |

---

## WebSocket 端点

### 客户端类型

| 类型 | 握手字段 | 用途 | 攻击面 |
|------|---------|------|--------|
| `agent` | `agentId`, `apiKey` | Agent 连接 | 认证绕过、命令注入 |
| `dashboard` | `token` (JWT) | Dashboard 连接 | Token 伪造 |

### Agent 事件 (→ 服务器)

| 事件名 | 方向 | 风险等级 | 描述 |
|--------|------|---------|------|
| `agent:register` | Agent → Server | 🟡 中 | Agent 注册 |
| `agent:heartbeat` | Agent → Server | 🟡 中 | 心跳包 - 可能被伪造 |
| `agent:threat` | Agent → Server | 🟠 高 | 威胁警报 - 可能被滥用 |
| `agent:scan_result` | Agent → Server | 🟡 中 | 扫描结果 |
| `agent:log` | Agent → Server | 🟢 低 | 日志数据 |
| `agent:command_ack` | Agent → Server | 🟢 低 | 命令确认 |
| `agent:command_failed` | Agent → Server | 🟢 低 | 命令失败 |

### Dashboard 事件 (→ 服务器)

| 事件名 | 方向 | 风险等级 | 描述 |
|--------|------|---------|------|
| `request:scan` | Dashboard → Server | 🟠 高 | 请求扫描 |
| `request:block_ip` | Dashboard → Server | 🔴 严重 | 请求封禁 IP - 命令注入 |
| `request:unblock_ip` | Dashboard → Server | 🔴 严重 | 请求解封 IP - 命令注入 |

### 服务器事件 (→ 客户端)

| 事件名 | 方向 | 描述 |
|--------|------|------|
| `command` | Server → Agent | 签名命令 |
| `agent:online` | Server → Dashboard | Agent 上线通知 |
| `agent:offline` | Server → Dashboard | Agent 下线通知 |
| `agent:status` | Server → Dashboard | Agent 状态 |
| `threat:detected` | Server → Dashboard | 威胁检测 |
| `scan:result` | Server → Dashboard | 扫描结果 |
| `audit:log` | Server → Dashboard | 审计日志 |

---

## 用户输入点

### HTTP 请求体输入

| 参数 | 端点 | 类型 | 验证状态 | 风险 |
|------|------|------|---------|------|
| `email` | /auth/register, /auth/login | Email | ✅ 已验证 | 🟢 低 |
| `password` | /auth/register, /auth/login | String | ⚠️ 长度仅8 | 🟡 中 |
| `ip` | /agents/:id/block | IP地址 | ❌ 未充分验证 | 🔴 严重 |
| `serverName` | /deployments/generate | String | ⚠️ 基础验证 | 🟡 中 |
| `upstream` | /deployments/generate | URL | ❌ 未验证 | 🟠 高 |
| `urls` | /scanner/tasks | URL[] | ❌ 未验证 | 🟠 高 |
| `command` | /devices/:id/cmd | String | ❌ 未验证 | 🟠 高 |
| `entries` | /devices/codebook | Object | ⚠XSS 检查 | 🟡 中 |

### URL 路径参数

| 参数 | 端点 | 类型 | 验证状态 | 风险 |
|------|------|------|---------|------|
| `:id` | /agents/:id | UUID | ⚠️ 未严格验证 | 🟡 中 |
| `:id` | /devices/:id | String | ⚠️ 未严格验证 | 🟡 中 |
| `:id` | /deployments/:id/download | UUID | ⚠️ 路径遍历风险 | 🟠 高 |
| `:id` | /scanner/tasks/:id | UUID | ✅ 已验证 | 🟢 低 |

### 查询参数

| 参数 | 端点 | 类型 | 验证状态 | 风险 |
|------|------|------|---------|------|
| `limit` | 多个端点 | Number | ✅ 上限验证 | 🟢 低 |
| `format` | /deployments/:id/download | Enum | ⚠️ 白名单 | 🟡 中 |
| `status` | /agent-onboarding/codes | Enum | ⚠️ 白名单 | 🟢 低 |

---

## 文件系统访问

### 读取路径

| 路径 | 组件 | 风险 |
|------|------|------|
| `/data/*.db` | SQLite 数据库 | 🟡 中 |
| `process.env.DATA_DIR` | 配置数据 | 🟠 高 |
| 自定义日志路径 | 日志收集器 | 🟠 高 |

### 写入路径

| 路径 | 组件 | 风险 |
|------|------|------|
| 数据库文件 | SQLite | 🟢 低 |
| 日志文件 | Logger | 🟢 低 |

---

## 网络协议

### 外部依赖

| 服务 | 端口 | 用途 | 风险 |
|------|------|------|------|
| Redis | 6379 | 缓存 | 🟡 中 - 明文传输 |
| HTTP/HTTPS | 80/443 | API | 🟢 低 |
| WebSocket | 3005/升级 | 实时通信 | 🟡 中 |

### 内部通信

| 服务 | 端口 | 用途 | 认证 |
|------|------|------|------|
| Backend → Redis | 6379 | 缓存 | 密码 |
| Agent → Backend | 3005/WSS | 心跳/命令 | API Key |
| Device → Backend | 3005/WSS | 设备管理 | API Key |

---

## 攻击向量汇总

### 1. 认证攻击面

```
┌─────────────────────────────────────────────────────────┐
│                   认证攻击                               │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ JWT 伪造  │  │ 暴力破解  │  │ Session  │              │
│  │ (CVE-001) │  │ /login   │  │ Fixation │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 2. 注入攻击面

```
┌─────────────────────────────────────────────────────────┐
│                   注入攻击                               │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  命令注入     │  │  SQL 注入    │  │  SSRF        │ │
│  │ (CVE-002)    │  │ (CVE-006)    │  │ (CVE-025)    │ │
│  │ 防火墙控制    │  │ 部署端点     │  │ 扫描器端点    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 3. 数据泄露攻击面

```
┌─────────────────────────────────────────────────────────┐
│                 数据泄露                                 │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  硬编码   │  │ 明文存储  │  │ 日志泄露  │              │
│  │  密钥     │  │ Agent    │  │ 敏感信息  │              │
│  │ (CVE-001) │  │ (CVE-014)│  │ (CVE-016)│              │
│  └──────────┘  └──────────┘  └──────────┘              │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 4. 客户端攻击面

```
┌─────────────────────────────────────────────────────────┐
│                 前端攻击                                 │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  XSS     │  │ localStorage │ CSP禁用  │              │
│  │ (潜在)   │  │ (CVE-007)│  │ (CVE-015)│              │
│  └──────────┘  └──────────┘  └──────────┘              │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 默认凭证

| 服务 | 用户名 | 密码 | 来源 |
|------|--------|------|------|
| AetherGuard Admin | `admin` | `admin123` | README.md |
| Redis | - | `AetherGuardRedis123!` | .env |
| 生产 API Key | - | `prod-api-key` | .env |
| 设备 API Key | - | `prod-device-key` | .env |

---

## 暴露的端口

| 端口 | 协议 | 服务 | 外部可访问 |
|------|------|------|-----------|
| 3005 | HTTP/WS | Backend API | ✅ 是 |
| 5173 | HTTP | Frontend Dev | ❌ 仅开发 |
| 6379 | TCP | Redis | ⚠️ 依赖配置 |

---

*生成时间: 2026-02-16 21:35 UTC*
*审计人员: Red Team Intelligence Analyst*
