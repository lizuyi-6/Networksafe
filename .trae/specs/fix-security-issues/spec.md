# 代码问题修复规范

## Why
根据代码质量检查报告，发现多个高优先级安全漏洞和代码缺陷需要修复，以确保系统安全性和稳定性。

## What Changes
- 修复后端安全模块的安全漏洞（Secret Key存储、Redis配置、IP欺骗）
- 修复API路由的安全问题（SSRF、IP注入、路由顺序）
- 修复WebSocket网关的安全缺失（速率限制、命令签名）
- 修复AI代理系统的代码缺陷（消息循环、忙等待）
- 修复前端上下文的问题（useEffect依赖循环）

## Impact
- Affected specs: 安全模块、API路由、WebSocket网关、AI代理、前端上下文
- Affected code:
  - backend/src/security/agent-auth.service.ts
  - backend/src/security/redis.service.ts
  - backend/src/middleware/rate-limit.middleware.ts
  - backend/src/api/routes/scanner.routes.ts
  - backend/src/api/routes/agents.routes.ts
  - backend/src/api/routes/devices.routes.ts
  - backend/src/websocket/device-gateway.ts
  - backend/src/ai-agents/investigation/agents/base-investigation.agent.ts
  - backend/src/ai-agents/core/message-bus.ts
  - frontend/src/context/DemoContext.tsx

## ADDED Requirements

### Requirement: Secret Key加密存储
系统应对代理认证的Secret Key进行加密存储，防止数据库泄露导致身份伪造。

#### Scenario: Secret Key加密
- **WHEN** 注册新代理时
- **THEN** Secret Key应使用AES-256-GCM加密后存储

### Requirement: Redis安全配置
系统应支持Redis的TLS连接和密码认证。

#### Scenario: Redis TLS连接
- **WHEN** 配置REDIS_TLS=true时
- **THEN** 系统应使用TLS连接Redis

### Requirement: IP地址验证
系统应对所有IP地址输入进行格式验证，防止注入攻击。

#### Scenario: IP格式验证
- **WHEN** 用户提交IP地址时
- **THEN** 系统应验证IP格式是否合法

### Requirement: URL验证和SSRF防护
系统应对扫描器URL输入进行验证，防止SSRF攻击。

#### Scenario: URL验证
- **WHEN** 提交扫描URL时
- **THEN** 系统应验证URL格式并过滤内网地址

### Requirement: Device网关安全增强
系统应为设备网关添加速率限制和命令签名机制。

#### Scenario: 速率限制
- **WHEN** 设备发送消息时
- **THEN** 系统应检查速率限制

### Requirement: AI代理消息处理修复
系统应修复消息处理的无限循环问题。

#### Scenario: 消息处理
- **WHEN** 代理处理消息时
- **THEN** 不应形成广播风暴

### Requirement: 前端useEffect依赖修复
系统应修复DemoContext的useEffect依赖循环问题。

#### Scenario: Demo模式切换
- **WHEN** 组件挂载时
- **THEN** useEffect应只执行一次
