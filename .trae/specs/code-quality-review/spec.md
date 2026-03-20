# 代码质量检查规范

## Why
对AetherGuard安全平台进行全面代码质量检查，确保代码符合安全标准、最佳实践，并识别潜在的问题和改进空间。

## What Changes
- 检查后端代码质量（API路由、安全模块、AI代理系统）
- 检查前端代码质量（页面组件、状态管理、API调用）
- 检查安全相关实现（认证、授权、输入验证）
- 检查代码一致性和最佳实践

## Impact
- Affected specs: 后端API、前端组件、安全模块
- Affected code: 
  - backend/src/api/routes/*
  - backend/src/security/*
  - backend/src/ai-agents/*
  - frontend/src/pages/*
  - frontend/src/context/*
  - frontend/src/services/*

## ADDED Requirements

### Requirement: 后端API路由检查
系统应对所有API路由进行代码质量检查，确保：
- 路由正确实现认证和授权
- 输入验证完整
- 错误处理规范
- 响应格式一致

#### Scenario: 检查认证路由
- **WHEN** 检查 auth.routes.ts
- **THEN** 确认登录、注册、令牌刷新等端点实现正确

#### Scenario: 检查代理管理路由
- **WHEN** 检查 agents.routes.ts
- **THEN** 确认代理注册、心跳、命令等端点实现正确

### Requirement: 安全模块检查
系统应对安全相关模块进行深度检查，确保：
- 输入验证覆盖所有攻击向量
- 速率限制正确配置
- 认证机制安全可靠
- 审计日志完整

#### Scenario: 检查输入验证器
- **WHEN** 检查 input-validator.ts
- **THEN** 确认SQL注入、XSS、路径遍历等攻击防护完整

#### Scenario: 检查认证安全
- **WHEN** 检查 auth-security.service.ts
- **THEN** 确认密码哈希、令牌生成、会话管理安全

### Requirement: AI代理系统检查
系统应对AI代理相关代码进行检查，确保：
- 代理通信机制正确
- 消息总线实现可靠
- 代理协调逻辑清晰

#### Scenario: 检查代理协调器
- **WHEN** 检查 agent-orchestrator.ts
- **THEN** 确认多代理协调、任务分配正确

### Requirement: 前端组件检查
系统应对前端页面组件进行检查，确保：
- 组件状态管理正确
- API调用规范
- 错误处理完善
- 用户体验良好

#### Scenario: 检查Dashboard页面
- **WHEN** 检查 Dashboard.tsx
- **THEN** 确认数据获取、展示、刷新逻辑正确

#### Scenario: 检查登录页面
- **WHEN** 检查 Login.tsx
- **THEN** 确认表单验证、认证流程、错误提示正确

### Requirement: 前端上下文检查
系统应对React Context进行检查，确保：
- 状态管理逻辑清晰
- 上下文提供者正确嵌套
- 性能优化到位

#### Scenario: 检查WebSocket上下文
- **WHEN** 检查 WebSocketContext.tsx
- **THEN** 确认连接管理、消息处理、重连机制正确

### Requirement: 代码一致性检查
系统应检查代码一致性，确保：
- 命名规范统一
- 代码风格一致
- 注释清晰有用
- 无冗余代码
