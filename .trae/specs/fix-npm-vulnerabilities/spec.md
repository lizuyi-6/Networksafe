# 修复NPM依赖安全漏洞规范

## Why
根据 npm audit 报告，后端和前端存在多个依赖包安全漏洞，需要修复以确保系统安全性。

## What Changes
- 修复后端 minimatch ReDoS 漏洞（6个高危）✅ 已完成
- 修复后端 fast-xml-parser Entity Expansion 漏洞（19个中危）- 使用 npm overrides ✅ 已完成
- 修复前端 esbuild 开发服务器请求伪造漏洞（2个中危）✅ 已完成
- 升级 TypeScript ESLint 相关依赖 ✅ 已完成
- Docker 容器构建和测试 ✅ 待执行

## Impact
- Affected specs: 安全加固
- Affected code:
  - backend/package.json (添加 overrides 配置)
  - frontend/package.json

## ADDED Requirements

### Requirement: 修复 minimatch ReDoS 漏洞 ✅
系统应修复 minimatch 包的正则表达式拒绝服务漏洞。

#### Scenario: 依赖升级
- **WHEN** 运行 npm audit 时
- **THEN** 不应报告 minimatch ReDoS 漏洞

### Requirement: 修复 fast-xml-parser 漏洞 ✅
系统应修复 XML 解析器实体扩展限制绕过漏洞。

#### Scenario: 使用 npm overrides 强制版本
- **WHEN** 运行 npm audit 时
- **THEN** 不应报告 fast-xml-parser 漏洞

### Requirement: 修复前端 esbuild 漏洞 ✅
系统应修复 esbuild 开发服务器请求伪造漏洞。

#### Scenario: 开发服务器安全
- **WHEN** 使用 npm audit --audit-level=moderate 检查前端时
- **THEN** 不应报告 esbuild 漏洞

### Requirement: Docker 容器构建和测试
系统应确保修复后的依赖在 Docker 容器中正常工作。

#### Scenario: Docker 构建
- **WHEN** 执行 docker-compose build 时
- **THEN** 后端和前端镜像构建成功

#### Scenario: Docker 服务启动
- **WHEN** 执行 docker-compose up -d 时
- **THEN** 所有服务健康运行

## 解决方案

### fast-xml-parser 漏洞修复方案

**问题**: AWS SDK 依赖 fast-xml-parser 4.0.0-beta.3 - 5.5.6 (有漏洞)

**解决**: fast-xml-parser 5.5.7+ 已修复漏洞，使用 npm overrides 强制使用修复版本

在 package.json 中添加:
```json
"overrides": {
  "fast-xml-parser": "^5.5.7"
}
```
