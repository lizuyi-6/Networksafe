# 页面卡片主题适配修复规范

## Why
多智能体和流量拦截器页面的卡片没能适配浅色主题，导致在亮色模式下显示不正确。

## What Changes
- 修复AgentMonitor页面的卡片主题适配
- 修复TrafficInterceptor页面的卡片主题适配
- 确保所有卡片组件正确响应主题变化

## Impact
- Affected specs: 主题系统、页面组件
- Affected code:
  - frontend/src/pages/AgentMonitor.tsx
  - frontend/src/pages/TrafficInterceptor.tsx

## ADDED Requirements

### Requirement: 卡片主题适配
系统应确保所有页面的卡片组件正确适配亮色和暗色主题。

#### Scenario: 卡片主题切换
- **WHEN** 用户切换主题时
- **THEN** 多智能体和流量拦截器页面的卡片应正确显示对应主题样式
