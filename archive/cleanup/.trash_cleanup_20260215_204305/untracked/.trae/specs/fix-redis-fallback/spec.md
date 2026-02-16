# Redis 连接容错修复规范

## Why
当 Redis 服务不可用时，多个安全服务直接调用 `redisService.getClient()` 导致请求失败或超时。需要确保所有 Redis 调用都有适当的容错处理。

## What Changes
- 修改 `auth-security.service.ts` - 所有 Redis 调用前检查可用性
- 修改 `anti-bot.middleware.ts` - 所有 Redis 调用前检查可用性
- 修改 `ratelimit.middleware.ts` - 所有 Redis 调用前检查可用性
- 修改 `enhanced-rate-limiter.service.ts` - 已部分修复，需完善

## Impact
- Affected specs: 认证安全、速率限制、反机器人检测
- Affected code: 
  - `backend/src/security/auth-security.service.ts`
  - `backend/src/security/anti-bot.middleware.ts`
  - `backend/src/security/ratelimit.middleware.ts`
  - `backend/src/security/enhanced-rate-limiter.service.ts`

## ADDED Requirements

### Requirement: Redis 容错处理
所有使用 Redis 的服务 SHALL 在调用 `redisService.getClient()` 前检查 `redisService.isAvailable()`，当 Redis 不可用时 SHALL 优雅降级。

#### Scenario: Redis 不可用时的登录
- **WHEN** Redis 服务不可用
- **AND** 用户尝试登录
- **THEN** 系统 SHALL 使用内存回退模式
- **AND** 登录请求 SHALL 正常完成

#### Scenario: Redis 不可用时的速率限制
- **WHEN** Redis 服务不可用
- **AND** 请求需要速率限制检查
- **THEN** 系统 SHALL 使用内存模式进行限制
- **AND** 请求 SHALL 正常处理

## MODIFIED Requirements

### Requirement: auth-security.service.ts
所有方法在调用 Redis 前 SHALL 检查 `redisService.isAvailable()`：
- `recordLoginAttempt()` - 记录登录尝试
- `getRecentAttempts()` - 获取最近尝试
- `lockAccount()` - 锁定账户
- `isAccountLocked()` - 检查锁定状态
- `getLockInfo()` - 获取锁定信息
- `unlockAccount()` - 解锁账户
- `checkIPBruteForce()` - 检查 IP 暴力破解
- `getFailedAttempts()` - 获取失败尝试
- `recordSession()` - 记录会话
- `invalidateSession()` - 使会话失效

### Requirement: anti-bot.middleware.ts
`checkRequestRate()` 方法 SHALL 在调用 Redis 前检查可用性，不可用时返回 `{ allowed: true, rate: 0 }`

### Requirement: ratelimit.middleware.ts
速率限制中间件 SHALL 在调用 Redis 前检查可用性，不可用时跳过限制检查
