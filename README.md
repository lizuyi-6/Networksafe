# FluxGuard - API Security Middleware

[![npm version](https://badge.fury.io/js/api-security-middleware.svg)](https://www.npmjs.com/package/api-security-middleware)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> ⚠️ **新用户必读：** 如果您是第一次打开此项目，请先查看 [**CONTINUE.md**](./CONTINUE.md) 获取完整的项目上下文和快速开始指南！

🛡️ **Comprehensive security middleware suite for Express.js API applications**

A production-ready collection of security middleware designed to protect your API from common threats including brute force attacks, DDoS, bot traffic, rate limiting issues, and more.

## ✨ Features

- 🔐 **Anti-Bot Protection** - Detects and blocks malicious bots and scrapers
- ⏱️ **Rate Limiting** - Redis-backed distributed rate limiting with atomic operations
- 🚦 **Concurrency Control** - Prevents resource exhaustion from concurrent requests
- 👤 **Auth Security** - Login attempt tracking, account lockout, and session management
- 📊 **Performance Monitoring** - Memory and CPU usage tracking with alerts
- 🎯 **Honeypot Fields** - Invisible form fields to trap spam bots
- 🔒 **IP Blocking** - Automatic IP blocking for suspicious activity
- 🌍 **Known Bot Whitelist** - Allows legitimate search engine crawlers

## 📦 Installation

```bash
npm install fluxguard-middleware
```

Or with yarn:

```bash
yarn add fluxguard-middleware
```

## 🚀 Quick Start

```typescript
import express from 'express';
import {
  antiBotMiddleware,
  rateLimitMiddleware,
  concurrencyLimit,
  authSecurityService
} from 'fluxguard-middleware';
import redis from 'ioredis';

const app = express();

// Initialize Redis (required for rate limiting and anti-bot features)
const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Apply security middleware
app.use(antiBotMiddleware.protect);
app.use(rateLimitMiddleware);
app.use(concurrencyLimit);

// Your routes
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  // Validate password
  const passwordCheck = authSecurityService.validatePassword(password);
  if (!passwordCheck.valid) {
    return res.status(400).json({
      error: 'Invalid password',
      details: passwordCheck.errors
    });
  }

  // Check for suspicious login
  const warnings = await authSecurityService.detectSuspiciousLogin(req, email);
  if (warnings.length > 0) {
    logger.warn('Suspicious login detected', { email, warnings });
  }

  // Check if account is locked
  const isLocked = await authSecurityService.isAccountLocked(email);
  if (isLocked) {
    const lockInfo = await authSecurityService.getLockInfo(email);
    return res.status(429).json({
      error: 'Account locked',
      reason: lockInfo.reason,
      retryAfter: lockInfo.remainingTime
    });
  }

  // Your login logic here...
});

app.listen(3000);
```

## 📚 Middleware Details

### 1. Anti-Bot Middleware

Protects your API from automated bots and scrapers with multiple detection methods:

**Features:**
- User-Agent analysis with suspicious pattern detection
- Known bot whitelist (Google, Bing, etc.)
- Request rate limiting (sliding window)
- Fast sequential request detection
- Honeypot field support
- IP blocking for repeated violations

**Usage:**

```typescript
import { antiBotMiddleware } from 'api-security-middleware';

// Apply globally
app.use(antiBotMiddleware.protect);

// Or to specific routes
app.post('/api/sensitive', antiBotMiddleware.protect, handler);
```

**Configuration:**

The middleware skips all checks in non-production environments. To customize:

```typescript
import { AntiBotMiddleware } from 'api-security-middleware';

const customAntiBot = new AntiBotMiddleware();
// Customize thresholds as needed
app.use(customAntiBot.protect);
```

### 2. Rate Limiting Middleware

Distributed rate limiting using Redis with atomic operations to prevent race conditions.

**Features:**
- Redis-backed for distributed systems
- Atomic operations prevent race conditions
- Configurable windows and limits
- Per-user rate limits
- Standard rate limit headers (`X-RateLimit-*`)

**Usage:**

```typescript
import { rateLimitMiddleware } from 'api-security-middleware';

// Requires API key authentication middleware before it
app.use(apiKeyAuthMiddleware, rateLimitMiddleware);
```

**Response Headers:**

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1704123456
Retry-After: 30
```

### 3. Concurrency Control

Prevents resource exhaustion by limiting concurrent requests per user.

**Features:**
- Per-user concurrent request limits
- Request queue management
- Automatic cleanup of stale requests
- Memory leak prevention

**Usage:**

```typescript
import { concurrencyLimit } from 'api-security-middleware';

app.use(concurrencyLimit);
```

**Response (when limit exceeded):**

```json
{
  "success": false,
  "error": {
    "message": "Too many concurrent requests. Please retry later.",
    "type": "concurrency_limit_exceeded"
  }
}
```

### 4. Auth Security Service

Comprehensive authentication security with login attempt tracking and account protection.

**Features:**

#### Password Validation
```typescript
const validation = authSecurityService.validatePassword('MyPass123!');
// Returns: { valid: true, errors: [], strength: 'medium' }
```

#### Login Attempt Tracking
```typescript
// Record login attempt
await authSecurityService.recordLoginAttempt(email, ip, success);

// Check if account is locked
const isLocked = await authSecurityService.isAccountLocked(email);

// Get lock information
const lockInfo = await authSecurityService.getLockInfo(email);
// Returns: { locked: true, reason: string, remainingTime: number }
```

#### Suspicious Login Detection
```typescript
const warnings = await authSecurityService.detectSuspiciousLogin(req, email);
// Returns array of warning messages
```

#### Session Management
```typescript
// Generate session ID
const sessionId = authSecurityService.generateSessionId();

// Validate session
const isValid = await authSecurityService.validateSession(userId, sessionId);

// Invalidate session
await authSecurityService.invalidateSession(userId);
```

#### Account Management
```typescript
// Unlock account
await authSecurityService.unlockAccount(email);

// Get failed attempts
const attempts = await authSecurityService.getFailedAttempts(email);
```

## 🎨 Honeypot Implementation

Add invisible honeypot fields to your forms to trap spam bots:

```html
<form method="POST" action="/api/contact">
  <!-- Visible fields -->
  <input type="text" name="name" required />
  <input type="email" name="email" required />

  <!-- Honeypot field (hidden with CSS) -->
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

The middleware automatically checks for the `website_confirm` field and blocks requests that fill it.

## 📊 Performance Monitoring

Monitor your application's performance:

```typescript
import {
  performanceMonitor,
  startMemoryMonitoring,
  startCPUMonitoring,
  stopMonitoring
} from 'api-security-middleware';

// Apply performance monitoring middleware
app.use(performanceMonitor);

// Start background monitoring
startMemoryMonitoring();
startCPUMonitoring();

// On shutdown
stopMonitoring();
```

**Headers Added:**
```
X-Response-Time: 45ms
```

**Logs Generated:**
```
[INFO] Slow request detected {"url":"/api/slow","method":"GET","duration":2500,"memoryUsed":"45.23MB"}
```

## ⚙️ Configuration

Default configuration is provided, but you can customize:

```typescript
import { defaultConfig } from 'api-security-middleware';

// Modify configuration
defaultConfig.rateLimit.requestsPerMinute = 120;
defaultConfig.antiBot.requestThreshold = 200;
defaultConfig.concurrency.maxConcurrentRequestsPerUser = 10;
```

### Environment Variables

```bash
# Required
REDIS_URL=redis://localhost:6379

# Optional
NODE_ENV=production
```

## 🔒 Security Best Practices

1. **Always Use HTTPS** - Security middleware works best with encrypted connections
2. **Configure Proper Redis Authentication** - Protect your Redis instance
3. **Monitor Logs** - Regularly review security logs for suspicious patterns
4. **Adjust Thresholds** - Tune limits based on your traffic patterns
5. **Test in Development** - Use `NODE_ENV=development` to bypass checks during testing

## 📈 Monitoring and Alerts

Set up monitoring for:

- Rate limit violations (429 responses)
- Blocked IPs
- Account lockouts
- Memory usage thresholds
- Unusual request patterns

## 🧪 Testing

The middleware automatically skips security checks in development/test environments:

```typescript
if (config.env !== 'production') {
  // Security checks are skipped
}
```

To test in production-like environment:

```bash
NODE_ENV=production npm test
```

## 📝 Examples

See the `/examples` directory for complete working examples:

- `basic-express-server.ts` - Simple Express server setup
- `advanced-configuration.ts` - Custom configuration example
- `auth-integration.ts` - Authentication integration
- `monitoring-setup.ts` - Performance monitoring setup

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

Built with:
- Express.js
- Redis (ioredis)
- TypeScript

## 📧 Support

For issues and questions:
- GitHub Issues: [https://github.com/yourusername/api-security-middleware/issues](https://github.com/yourusername/api-security-middleware/issues)
- Email: your-email@example.com

## 🔗 Links

- [Documentation](https://github.com/yourusername/api-security-middleware#readme)
- [Examples](https://github.com/yourusername/api-security-middleware/tree/main/examples)
- [Changelog](https://github.com/yourusername/api-security-middleware/blob/main/CHANGELOG.md)

---


## 🐳 Docker Support

FluxGuard includes full Docker support for running the entire stack (Frontend, Backend, and Redis).

### Prerequisites
- Docker & Docker Compose installed

### Running the Project
To start all services:

```bash
docker-compose up --build
```

Access the application:
- **Frontend Dashboard**: http://localhost:5173
- **Backend API**: http://localhost:3005

**Made with ❤️ for secure APIs**
