# 归档整理重复文档 Spec

## Why
项目中存在多处重复、历史遗留和内容重叠的文档，导致维护困难、信息混乱，需要系统性地归档整理以保持工作区整洁。

## What Changes
- 创建 `docs/archive/` 归档目录结构
- 移动已标记为历史/归档的文档到归档目录
- 删除或合并明确重复的文档
- 更新相关文档的引用关系

## Impact
- Affected specs: 文档结构
- Affected code: 
  - `docs/` 目录下多个文档文件
  - 可能影响引用这些文档的其他文件

## ADDED Requirements

### Requirement: 归档目录结构
系统应建立清晰的归档目录结构，便于区分活跃文档和历史文档。

#### Scenario: 创建归档目录
- **WHEN** 执行归档整理
- **THEN** 应创建 `docs/archive/` 目录及子目录（hardware/, manuals/, reports/）

### Requirement: 历史硬件文档归档
系统应将已标记为归档的硬件文档移动到归档目录。

#### Scenario: 归档硬件设计方案书
- **WHEN** `硬件设计方案书.md` 已在文档内标记为 "Archived reference"
- **THEN** 应移动到 `docs/archive/hardware/` 并保持原文件名

#### Scenario: 添加硬件设计亮点归档警告
- **WHEN** `硬件设计亮点.md` 描述的是 v22.0 旧设计
- **THEN** 应在文档开头添加归档警告，或移动到归档目录

### Requirement: 重复软著材料归档
系统应保留最完整的软著手册版本，归档其他重复版本。

#### Scenario: 软著手册版本选择
- **WHEN** 存在多个软著手册版本（`软件操作说明书.md`、`copyright_user_manual_60pages.md`、`copyright_manual_full.md`）
- **THEN** 保留 `软件操作说明书.md`（607行最完整版），归档其他版本

### Requirement: 安全报告摘要归档
系统应归档作为完整报告子集的摘要文档。

#### Scenario: 安全执行摘要归档
- **WHEN** `AetherGuard-Security-Executive-Summary.md` 是 `AetherGuard-Security-Whitepaper.md` 的精简子集
- **THEN** 应移动到 `docs/archive/reports/`

## MODIFIED Requirements
无

## REMOVED Requirements
无

## 归档清单

### 高优先级归档（确认移动）

| 文件 | 目标位置 | 原因 |
|------|----------|------|
| `docs/硬件设计方案书.md` | `docs/archive/hardware/硬件设计方案书_v1_screwless.md` | 文档自带归档标记 |
| `docs/硬件设计亮点.md` | 添加归档警告或移动到 `docs/archive/hardware/` | 描述 v22.0 旧设计 |
| `docs/reports/AetherGuard-Security-Executive-Summary.md` | `docs/archive/reports/` | 是白皮书的子集 |
| `docs/copyright_user_manual_60pages.md` | `docs/archive/manuals/` | 与软著主版本重复 |
| `docs/copyright_manual_full.md` | `docs/archive/manuals/` | 与软著主版本重复 |

### 待评估（中优先级）

| 文件 | 原因 | 建议 |
|------|------|------|
| `docs/技术实施手册.md` | 与 `technical_manual.md` 高度相似 | 合并为一个文档 |
| `docs/product_manual.md` | 与 `technical_manual.md` 内容重叠 | 明确用途或合并 |

### 目标目录结构

```
docs/
├── archive/                           # 归档目录（新建）
│   ├── hardware/                      # 硬件历史文档
│   │   └── 硬件设计方案书_v1_screwless.md
│   ├── manuals/                       # 旧版手册
│   │   ├── copyright_user_manual_60pages.md
│   │   └── copyright_manual_full.md
│   └── reports/                       # 旧版报告
│       └── AetherGuard-Security-Executive-Summary.md
├── (其他现有文档保持不变)
```
