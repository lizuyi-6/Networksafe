# 深度检索归档文档 Spec

## Why
项目文档深度检索发现更多重复、历史和临时文件，需要继续归档以保持工作区整洁。

## What Changes
- 归档 nginx 配置历史迭代版本
- 归档红队测试历史报告
- 归档重复的环境配置文件
- 归档论文项目状态文档（已完成）
- 整理 KiCad 临时文件目录

## Impact
- Affected specs: 文档结构
- Affected code: 
  - `deployment/` 目录下的 nginx 配置文件
  - `redteam/` 目录下的历史报告
  - `papers/SCI-main/` 项目状态文档
  - `hardware/kicad/esp32-serial-deployer-pcb/scratch/` 临时文件

## ADDED Requirements

### Requirement: Nginx 配置历史迭代归档
系统应将历史 nginx 配置迭代版本归档到专门目录。

#### Scenario: 归档 nginx 历史版本
- **WHEN** 存在多个 nginx 配置迭代版本（`nginx_acme_fallback.conf`, `nginx_acme_fix.conf`, `nginx_patched.conf`, `nginx_safe.conf`）
- **THEN** 应移动到 `docs/archive/deployment/nginx-iterations/`

### Requirement: 红队测试历史报告归档
系统应将历史轮次的红队测试报告归档，保留最新版本。

#### Scenario: 归档红队历史报告
- **WHEN** 存在多轮红队测试报告（round1/round2/round3）
- **THEN** 应归档 round1 和 round2 报告到 `docs/archive/redteam/`

### Requirement: 重复环境配置文件删除
系统应删除完全重复的环境配置文件。

#### Scenario: 删除重复配置文件
- **WHEN** `deployment/production/aetherguard-serial-helper.env.example` 与 bundle 中文件完全相同
- **THEN** 应删除 production 目录下的重复文件

### Requirement: 论文项目状态文档归档
系统应归档已完成项目的状态文档。

#### Scenario: 归档 SCI 项目文档
- **WHEN** `papers/SCI-main/PROJECT-STATUS.md` 和 `PAPER-COMPLETION-REPORT.md` 表示项目已完成
- **THEN** 应移动到 `docs/archive/papers/`

## MODIFIED Requirements
无

## REMOVED Requirements
无

## 归档清单

### 高优先级归档

| 类别 | 文件 | 目标位置 |
|------|------|----------|
| nginx历史 | `deployment/nginx_acme_fallback.conf` | `docs/archive/deployment/nginx-iterations/` |
| nginx历史 | `deployment/nginx_acme_fix.conf` | `docs/archive/deployment/nginx-iterations/` |
| nginx历史 | `deployment/nginx_patched.conf` | `docs/archive/deployment/nginx-iterations/` |
| nginx历史 | `deployment/nginx_safe.conf` | `docs/archive/deployment/nginx-iterations/` |
| 红队历史 | `redteam/pentest_report.md` | `docs/archive/redteam/round1/` |
| 红队历史 | `redteam/round2_attack_report.md` | `docs/archive/redteam/round2/` |
| 重复配置 | `deployment/production/aetherguard-serial-helper.env.example` | 删除（与 bundle 重复） |
| 论文状态 | `papers/SCI-main/PROJECT-STATUS.md` | `docs/archive/papers/` |
| 论文状态 | `papers/SCI-main/PAPER-COMPLETION-REPORT.md` | `docs/archive/papers/` |

### 中优先级（本次不处理）

| 类别 | 说明 |
|------|------|
| KiCad scratch 目录 | 200+ 临时文件，建议单独处理 |
| IEEE upload-package | 自动生成目录，建议在 .gitignore 中忽略 |
