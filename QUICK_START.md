# 网络安全防护中间件 - 快速参考指南

## 📦 包概述

这是从您的API Gateway项目中提取的完整网络安全防护中间件套件，已打包为独立的npm包。

## 📁 包结构

```
api-security-middleware/
├── src/
│   ├── middleware/           # 中间件
│   │   ├── anti-bot.middleware.ts       # 反机器人防护
│   │   ├── concurrency.middleware.ts    # 并发控制
│   │   └── ratelimit.middleware.ts      # 速率限制
│   ├── services/             # 服务
│   │   ├── redis.service.ts             # Redis服务
│   │   └── auth-security.service.ts     # 认证安全服务
│   ├── utils/                # 工具
│   │   └── logger.ts                   # 日志工具
│   ├── config.ts             # 配置文件
│   ├── types.ts              # 类型定义
│   └── index.ts              # 主入口
├── examples/                 # 使用示例
├── dist/                     # 编译输出（构建后生成）
├── package.json
├── tsconfig.json
├── README.md                 # 完整文档
└── CHANGELOG.md             # 更新日志
```

## 🚀 核心功能

### 1. **反机器人中间件** (`anti-bot.middleware.ts`)

**功能：**
- ✅ 检测和阻止恶意机器人
- ✅ 已知机器人白名单（Google、Bing等）
- ✅ 可疑User-Agent模式检测
- ✅ 请求速率限制（滑动窗口）
- ✅ 快速连续请求检测
- ✅ 蜜罐字段支持
- ✅ IP自动封禁

**使用方式：**
```typescript
import { antiBotMiddleware } from 'api-security-middleware';

app.use(antiBotMiddleware.protect);
```

### 2. **速率限制中间件** (`ratelimit.middleware.ts`)

**功能：**
- ✅ 基于Redis的分布式速率限制
- ✅ 原子操作防止竞态条件
- ✅ 每用户独立限制
- ✅ 标准速率限制HTTP头

**使用方式：**
```typescript
import { rateLimitMiddleware } from 'api-security-middleware';

app.use(rateLimitMiddleware);
```

**响应头：**
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1704123456
```

### 3. **并发控制中间件** (`concurrency.middleware.ts`)

**功能：**
- ✅ 每用户并发请求数限制
- ✅ 请求队列管理
- ✅ 自动清理过期请求
- ✅ 防止内存泄漏
- ✅ 线程安全的槽位获取

**使用方式：**
```typescript
import { concurrencyLimit } from 'api-security-middleware';

app.use(concurrencyLimit);
```

**响应示例：**
```json
{
  "success": false,
  "error": {
    "message": "Too many concurrent requests. Please retry later.",
    "type": "concurrency_limit_exceeded"
  }
}
```

### 4. **认证安全服务** (`auth-security.service.ts`)

**功能：**
- ✅ 密码强度验证
- ✅ 登录尝试追踪
- ✅ 账户自动锁定
- ✅ 暴力破解检测
- ✅ 可疑登录检测
- ✅ 会话管理
- ✅ 并发会话控制

**使用方式：**
```typescript
import { authSecurityService } from 'api-security-middleware';

// 密码验证
const check = authSecurityService.validatePassword('MyPass123!');

// 记录登录尝试
await authSecurityService.recordLoginAttempt(email, ip, success);

// 检查账户是否被锁定
const isLocked = await authSecurityService.isAccountLocked(email);

// 检测可疑登录
const warnings = await authSecurityService.detectSuspiciousLogin(req, email);

// 生成会话ID
const sessionId = authSecurityService.generateSessionId();
```

### 5. **性能监控** (`concurrency.middleware.ts`)

**功能：**
- ✅ 请求时间追踪
- ✅ 内存使用监控
- ✅ CPU使用监控
- ✅ 慢查询检测
- ✅ 自动清理函数

**使用方式：**
```typescript
import {
  performanceMonitor,
  startMemoryMonitoring,
  startCPUMonitoring,
  stopMonitoring
} from 'api-security-middleware';

app.use(performanceMonitor);
startMemoryMonitoring();
startCPUMonitoring();

// 关闭时
stopMonitoring();
```

## 📝 典型使用场景

### 场景1：基本API保护

```typescript
import express from 'express';
import {
  antiBotMiddleware,
  concurrencyLimit,
  performanceMonitor
} from 'api-security-middleware';

const app = express();

// 应用所有保护
app.use(antiBotMiddleware.protect);
app.use(performanceMonitor);
app.use(concurrencyLimit);

app.get('/api/data', (req, res) => {
  res.json({ data: 'protected' });
});
```

### 场景2：登录保护

```typescript
import { authSecurityService } from 'api-security-middleware';

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  // 1. 验证密码强度
  const passwordCheck = authSecurityService.validatePassword(password);
  if (!passwordCheck.valid) {
    return res.status(400).json({ error: passwordCheck.errors });
  }

  // 2. 检测可疑登录
  const warnings = await authSecurityService.detectSuspiciousLogin(req, email);
  if (warnings.length > 0) {
    // 记录警告
    console.warn('Suspicious login', warnings);
  }

  // 3. 检查账户锁定状态
  const isLocked = await authSecurityService.isAccountLocked(email);
  if (isLocked) {
    const lockInfo = await authSecurityService.getLockInfo(email);
    return res.status(429).json({
      error: 'Account locked',
      retryAfter: lockInfo.remainingTime
    });
  }

  // 4. 执行认证
  const success = await authenticate(email, password);

  // 5. 记录登录尝试
  const ip = req.ip || 'unknown';
  await authSecurityService.recordLoginAttempt(email, ip, success);

  if (!success) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json({ success: true });
});
```

### 场景3：注册时的密码验证

```typescript
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;

  // 验证密码
  const validation = authSecurityService.validatePassword(password);

  if (!validation.valid) {
    return res.status(400).json({
      error: 'Weak password',
      details: validation.errors,
      strength: validation.strength
    });
  }

  // 创建用户...
  await createUser(email, password);

  res.json({ success: true });
});
```

### 场景4：蜜罐字段实现

在前端表单中添加隐藏字段：

```html
<form method="POST" action="/api/contact">
  <input type="text" name="name" required />
  <input type="email" name="email" required />

  <!-- 蜜罐字段 - 对用户不可见 -->
  <input
    type="text"
    name="website_confirm"
    style="position:absolute;left:-9999px"
    tabindex="-1"
    autocomplete="off"
  />

  <button type="submit">Submit</button>
</form>
```

中间件会自动检测并阻止填充了蜜罐字段的请求。

## ⚙️ 配置选项

### 环境变量

```bash
# Redis连接（必需）
REDIS_URL=redis://localhost:6379

# 运行环境
NODE_ENV=production  # 或 development, test
```

### 默认配置值

```typescript
{
  rateLimit: {
    requestsPerMinute: 60,
    windowSeconds: 60
  },
  antiBot: {
    requestThreshold: 100,
    fastRequestThreshold: 10,
    blockDuration: 3600
  },
  concurrency: {
    maxConcurrentRequestsPerUser: 5,
    maxQueueSize: 20
  },
  authSecurity: {
    maxLoginAttempts: 5,
    lockoutDuration: 900,
    attemptWindow: 300
  }
}
```

## 🛡️ 安全特性总结

| 特性 | 描述 | 中间件/服务 |
|------|------|------------|
| 反机器人 | 检测并阻止恶意机器人 | `antiBotMiddleware` |
| 速率限制 | 防止API滥用 | `rateLimitMiddleware` |
| 并发控制 | 防止资源耗尽 | `concurrencyLimit` |
| 登录保护 | 防止暴力破解 | `authSecurityService` |
| 账户锁定 | 自动锁定可疑账户 | `authSecurityService` |
| 密码验证 | 强密码策略 | `authSecurityService` |
| 会话管理 | 安全的会话处理 | `authSecurityService` |
| 性能监控 | 追踪性能指标 | `performanceMonitor` |
| 蜜罐字段 | 陷阱机器人 | `antiBotMiddleware` |

## 📊 监控和日志

### 自动生成的日志

```
[2026-01-13T12:00:00.000Z] [INFO] Redis connected successfully
[2026-01-13T12:00:01.000Z] [WARN] Slow request detected {"duration":2500,"url":"/api/slow"}
[2026-01-13T12:00:02.000Z] [ERROR] Account locked due to too many failed attempts {"email":"test@example.com"}
[2026-01-13T12:00:03.000Z] [WARN] Suspicious user agent blocked {"userAgent":"curl/7.68.0"}
```

### 性能指标

- 请求持续时间（添加到响应头：`X-Response-Time`）
- 内存使用情况（当超过阈值时警告）
- CPU使用情况（定期记录）

## 🧪 测试建议

### 开发环境
在开发环境中，所有安全检查都会自动跳过：

```typescript
if (config.env !== 'production') {
  // 安全检查被跳过
  next();
  return;
}
```

### 生产测试
在生产环境测试时：

1. 逐步增加流量
2. 监控错误日志
3. 调整阈值
4. 观察性能影响

## 🔧 故障排除

### 问题1：Redis连接失败

```bash
Error: Redis connection failed
```

**解决方法：**
- 确保Redis正在运行
- 检查`REDIS_URL`环境变量
- 验证网络连接

### 问题2：速率限制过于严格

**解决方法：**
```typescript
import { defaultConfig } from 'api-security-middleware';

defaultConfig.rateLimit.requestsPerMinute = 120; // 增加限制
```

### 问题3：合法用户被阻止

**解决方法：**
- 检查日志找出阻止原因
- 将IP添加到白名单（如需要）
- 调整检测阈值

## 📚 相关资源

- **完整文档**：`README.md`
- **更新日志**：`CHANGELOG.md`
- **使用示例**：`examples/`目录
- **原始项目**：您的API Gateway项目

## 🎯 下一步

1. **构建包**：
   ```bash
   cd api-security-middleware
   npm install
   npm run build
   ```

2. **本地测试**：
   ```bash
   npm link
   cd ../your-project
   npm link api-security-middleware
   ```

3. **发布到npm**：
   ```bash
   npm publish
   ```

4. **在其他项目中使用**：
   ```bash
   npm install api-security-middleware
   ```

---

**提取完成！** 您的网络安全防护功能现在已经是一个独立、可重用的npm包了。🎉
