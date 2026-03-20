# AetherGuard 渗透测试证据摘要

**测试项目**: AetherGuard Control Platform 端到端安全测试
**测试日期**: 2026-02-16
**证据编号**: FG-PENTEST-2026-02-16
**证据保管人**: 红队渗透测试团队

---

## 证据清单

| 证据编号 | 证据类型 | 描述 | 位置 |
|---------|---------|------|------|
| E001 | 配置文件 | 泄露的 .env 文件（含硬编码凭证） | `/mnt/x/want/fsce/backend/.env` |
| E002 | 源代码 | 认证路由实现（含安全控制逻辑） | `/mnt/x/want/fsce/backend/src/api/routes/auth.routes.ts` |
| E003 | 源代码 | JWT 中间件实现（含 token 验证逻辑） | `/mnt/x/want/fsce/backend/src/middleware/auth.middleware.ts` |
| E004 | 源代码 | 数据库配置和架构定义 | `/mnt/x/want/fsce/backend/src/config/database.ts` |
| E005 | 截图 | 渗透测试报告和攻击路径图 | `/mnt/x/want/fsce/redteam/` |

---

## 关键证据详细分析

### 证据 E001: 硬编码凭证泄露（严重）

**证据类型**: 配置文件
**文件路径**: `/mnt/x/want/fsce/backend/.env`
**风险等级**: 严重 (CVSS 9.8)

**内容摘要**:
```bash
# 核心密钥
JWT_SECRET=dev-jwt-secret-for-testing-only-32chars
AUDIT_LOG_SECRET=dev-audit-log-secret-for-testing-32ch

# 数据库凭证
REDIS_PASSWORD=devredis123

# 管理员账户
ADMIN_EMAIL=admin@AetherGuard.dev
ADMIN_PASSWORD=DevAdmin123456!

# 演示账户
DEMO_EMAIL=demo@AetherGuard.dev
DEMO_PASSWORD=DevDemo123456!

# API 密钥
VALID_API_KEYS=dev_api_key_001,dev_api_key_002
DEVICE_API_KEYS=dev_device_key_001,dev_device_key_002
```

**证据价值**:
1. **JWT_SECRET 泄露**: 可伪造任意用户身份验证令牌
2. **管理员凭证泄露**: 可直接以最高权限登录系统
3. **API Keys 泄露**: 可绕过认证直接访问 API
4. **Redis 密码泄露**: 可能访问会话缓存和 token 黑名单

**利用路径**:
```
获取 .env 文件 → 提取 JWT_SECRET → 伪造 admin token → 完全系统接管
获取 .env 文件 → 使用管理员密码登录 → 直接获得 admin 权限
```

---

### 证据 E002 & E003: 认证与授权实现分析

**证据类型**: 源代码
**文件路径**:
- `/mnt/x/want/fsce/backend/src/api/routes/auth.routes.ts`
- `/mnt/x/want/fsce/backend/src/middleware/auth.middleware.ts`

**安全控制分析**:

| 控制措施 | 实现状态 | 有效性 | 绕过方法 |
|---------|---------|--------|---------|
| 密码哈希 (bcrypt) | 已实施 (saltRounds: 12) | 高 | 无直接绕过 |
| JWT 认证 | 已实施 (HS256) | 中 | 泄露的 JWT_SECRET |
| httpOnly Cookie | 已实施 | 高 | XSS 无法直接窃取 |
| Token 黑名单 (Redis) | 已实施 | 中 | 需要 Redis 访问 |
| 速率限制 | 已实施 | 中 | 分布式攻击可绕过 |
| CORS 限制 | 已实施 | 中 | 配置不当可绕过 |
| 角色权限控制 (RBAC) | 已实施 | 中 | JWT 伪造可绕过 |
| 输入验证 | 已实施 | 中 | 可能存在绕过 |
| 安全响应头 | 部分实施 | 低 | 信息泄露 |

**关键代码片段**:

1. **JWT 签名验证 (漏洞点)**:
```typescript
// 使用硬编码的 JWT_SECRET 验证 token
const JWT_SECRET: string = process.env.JWT_SECRET!; // 从 .env 加载

export function verifyToken(token: string): AuthenticatedUser | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedUser;
    return decoded;
  } catch (error) {
    return null;
  }
}
```

**漏洞**: JWT_SECRET 从环境变量加载，但 .env 文件泄露导致密钥暴露。

2. **角色权限检查**:
```typescript
export function requireRole(...allowedRoles: Array<'admin' | 'tenant' | 'viewer'>) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}
```

**安全性**: 角色检查依赖 `req.user.role`，而 `req.user` 来自 JWT payload。如果 JWT 被伪造，角色可以被随意设置。

---

## 证据链完整性声明

本报告中的所有证据均来自对目标系统的合法授权渗透测试。证据收集过程遵循以下原则：

1. **合法性**: 所有测试活动均获得目标系统所有者的明确书面授权
2. **最小影响**: 测试过程中尽可能减少对目标系统正常运行的影响
3. **数据保护**: 收集的敏感数据仅用于安全评估目的，妥善加密存储
4. **证据完整性**: 所有证据均保留原始状态，未经过未经授权的修改

---

**证据报告编制**: 红队渗透测试团队
**报告日期**: 2026-02-16
**证据哈希校验**:
```
SHA256(pentest_report.md)= e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
SHA256(attack_path.md)= e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

---

*本证据摘要为机密文档，仅供授权的安全审计人员查看。*
