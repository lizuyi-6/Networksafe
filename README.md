# FluxGuard - API 安全中间件

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

🛡️ **适用于 Express.js API 应用的全方位安全中间件套件**

FluxGuard 是一个生产就绪的安全中间件集合，旨在保护您的 API 免受常见威胁，包括暴力破解、DDoS 攻击、恶意机器人流量、速率限制滥用等。

## ✨ 主要功能

- 🔐 **反爬虫保护 (Anti-Bot)** - 智能检测并阻止恶意机器人和爬虫
- ⏱️ **速率限制 (Rate Limiting)** - 基于 Redis 的分布式速率限制，确保原子操作
- 🚦 **并发控制 (Concurrency Control)** - 防止因并发请求过多导致的资源耗尽
- 👤 **认证安全 (Auth Security)** - 登录尝试追踪、账户锁定和会话管理
- 📊 **性能监控 (Performance Monitoring)** - 实时监控内存和 CPU 使用情况并并在异常时预警
- 🎯 **蜜罐陷阱 (Honeypot)** - 使用不可见的表单字段捕获垃圾邮件机器人
- 🔒 **自动 IP 封禁** - 对可疑活动进行自动 IP 拦截
- 🌍 **搜索引擎白名单** - 允许 Google、Bing 等合法搜索引擎爬虫访问

## 📦 安装

使用 npm 安装：

```bash
npm install fluxguard-middleware
```

或者使用 yarn：

```bash
yarn add fluxguard-middleware
```

## 🚀 快速开始

```typescript
import express from 'express';
import { 
  antiBotMiddleware, 
  rateLimitMiddleware, 
  concurrencyLimit,
  authSecurityService 
} from 'fluxguard-middleware';
import Redis from 'ioredis';

const app = express();

// 初始化 Redis (速率限制和反爬虫功能需要)
const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// 应用安全中间件
app.use(antiBotMiddleware.protect);
app.use(rateLimitMiddleware);
app.use(concurrencyLimit);

// 业务路由示例
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  // 1. 密码强度验证
  const passwordCheck = authSecurityService.validatePassword(password);
  if (!passwordCheck.valid) {
    return res.status(400).json({ error: '密码强度不足', details: passwordCheck.errors });
  }

  // 2. 检测可疑登录
  const warnings = await authSecurityService.detectSuspiciousLogin(req, email);
  if (warnings.length > 0) {
    console.warn('检测到可疑登录:', { email, warnings });
  }

  // 3. 检查账户是否锁定
  if (await authSecurityService.isAccountLocked(email)) {
    return res.status(429).json({ error: '账户已锁定，请稍后再试' });
  }

  // 执行登录逻辑...
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

## 📚 中间件详情

### 1. 反爬虫中间件 (Anti-Bot)
通过多种检测方法保护您的 API 免受自动化机器人和爬虫的侵害：
- User-Agent 分析与异常模式检测
- 针对已知机器人（如 GoogleBot）的白名单机制
- 请求速率异常检测（快速滑动窗口）
- 支持蜜罐字段诱捕

### 2. 分布式速率限制 (Rate Limiting)
使用 Redis 实现的分布式限流，支持原子操作以防止竞争条件。
- 支持自定义时间窗口和请求限制
- 基于用户的限流策略
- 标准限流响应头 (`X-RateLimit-*`)

### 3. 并发控制
限制每个用户的并发请求数，防止资源耗尽。
- 自动清理过期请求
- 防止内存泄漏

### 4. 认证安全服务
提供全面的认证安全功能：
- **密码验证**：检查密码复杂度
- **暴力破解防护**：自动锁定多次失败的账户
- **会话管理**：生成和验证安全会话 ID

## 🐳 Docker 支持

本项目包含完整的 Docker 支持，可一键启动所有服务（前端、后端和 Redis）。

**启动命令：**
```bash
docker-compose up --build
```

**服务访问：**
- **前端控制台**: http://localhost:5173
- **后端 API**: http://localhost:3005

## ⚙️ 配置

支持通过环境变量进行配置：

```bash
# 必需配置
REDIS_URL=redis://localhost:6379

# 可选配置
NODE_ENV=production
ALLOWED_ORIGINS=http://localhost:5173
```

## 📄 许可证

MIT License
