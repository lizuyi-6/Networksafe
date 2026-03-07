# WebSocket和认证问题修复规范

## Why
前端无法连接WebSocket服务，登录接口返回401错误，导致用户无法正常使用系统。

## What Changes
- 修复WebSocket代理配置，确保Socket.IO正确连接
- 修复静态资源路径问题（vite.svg 404）
- 检查认证接口配置，解决401 Unauthorized问题

## Impact
- Affected specs: WebSocket连接、认证系统、静态资源服务
- Affected code:
  - frontend/nginx.conf
  - backend/src/websocket/
  - backend/src/api/routes/auth.routes.ts
  - frontend/dist/

## ADDED Requirements

### Requirement: WebSocket代理配置
系统应正确配置Nginx代理，支持WebSocket长连接。

#### Scenario: WebSocket连接
- **WHEN** 前端尝试建立WebSocket连接
- **THEN** 应成功连接到后端Socket.IO服务

### Requirement: 静态资源服务
系统应正确提供所有静态资源文件。

#### Scenario: 静态资源访问
- **WHEN** 请求vite.svg等静态资源
- **THEN** 应返回正确的文件内容

### Requirement: 认证接口可用
系统应正确响应认证请求。

#### Scenario: 用户登录
- **WHEN** 用户提交正确的登录凭据
- **THEN** 应返回成功响应和认证令牌
