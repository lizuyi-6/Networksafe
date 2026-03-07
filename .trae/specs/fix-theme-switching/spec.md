# 主题切换功能修复规范

## Why
部分页面的主题切换功能失效或适配不完整，导致用户在切换明暗主题时体验不一致。

## What Changes
- 检查并修复ThemeContext的实现
- 检查各页面组件的主题适配
- 确保所有页面正确响应主题变化

## Impact
- Affected specs: 主题系统、页面组件
- Affected code:
  - frontend/src/context/ThemeContext.tsx
  - frontend/src/pages/*.tsx
  - frontend/src/index.css

## ADDED Requirements

### Requirement: 主题切换功能
系统应在所有页面正确响应主题切换。

#### Scenario: 主题切换
- **WHEN** 用户切换主题（亮色/暗色/系统）
- **THEN** 所有页面应立即更新为对应主题

### Requirement: 主题持久化
系统应持久化用户的主题选择。

#### Scenario: 主题持久化
- **WHEN** 用户刷新页面
- **THEN** 应保持用户选择的主题

### Requirement: 系统主题跟随
系统应支持跟随系统主题设置。

#### Scenario: 系统主题变化
- **WHEN** 系统主题变化时
- **THEN** 应用应自动切换到对应主题
