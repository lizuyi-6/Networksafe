# 页面卡片主题适配重新修复规范

## Why
多智能体监控和流量拦截器页面的卡片主题适配问题仍然存在，之前的修复可能未正确部署或不完整。

## What Changes
- 重新检查AgentMonitor.tsx和TrafficInterceptor.tsx的主题适配
- 确保修复正确应用
- 重新编译并部署到Docker

## Impact
- Affected specs: 主题系统、页面组件
- Affected code:
  - frontend/src/pages/AgentMonitor.tsx
  - frontend/src/pages/TrafficInterceptor.tsx

## ADDED Requirements

### Requirement: 卡片主题适配验证
系统应验证卡片组件的主题适配是否正确实现。

#### Scenario: 主题切换验证
- **WHEN** 用户切换主题时
- **THEN** 多智能体监控和流量拦截器页面的卡片应正确显示对应主题样式
