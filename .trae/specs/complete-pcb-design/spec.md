# ESP32 Serial Deployer PCB 设计完成规范

## Why
当前 ESP32 Serial Deployer PCB v1 设计尚未完成，ERC 和 DRC 存在问题，无法进行制造。需要完成设计使其达到可制造状态。

## What Changes
- 清理 ERC 警告和错误
- 修复 PCB DRC 违规（当前3个违规 + 39个未连接项）
- 完成地线和电源走线闭合
- 验证封装和钻孔尺寸
- 生成制造文件（Gerber, Drill, BOM）

## Impact
- Affected specs: 硬件设计
- Affected code:
  - hardware/kicad/esp32-serial-deployer-pcb/esp32-serial-deployer-pcb.kicad_sch
  - hardware/kicad/esp32-serial-deployer-pcb/esp32-serial-deployer-pcb.kicad_pcb

## ADDED Requirements

### Requirement: ERC 清理
系统应通过电气规则检查，无警告或错误。

#### Scenario: ERC 检查
- **WHEN** 运行 kicad-cli sch erc 时
- **THEN** 无 ERC 错误或警告

### Requirement: PCB DRC 通过
系统应通过设计规则检查。

#### Scenario: DRC 检查
- **WHEN** 运行 kicad-cli pcb drc 时
- **THEN** 0 个 DRC 违规

### Requirement: 原理图与 PCB 一致性
系统应确保原理图和 PCB 之间没有差异。

#### Scenario: Parity 检查
- **WHEN** 运行 kicad-cli pcb drc --schematic-parity 时
- **THEN** 无不一致

### Requirement: 制造文件生成
系统应生成完整的制造文件集。

#### Scenario: 制造文件
- **WHEN** 导出制造文件时
- **THEN** 包含 Gerber, Drill, BOM 文件

## 当前问题清单

### ERC 问题
- 高噪声，需要原理图清理

### PCB DRC 问题
- 3 个 DRC 违规
- 39 个未连接项
- 集中在接地和电源闭合区域

### 剩余工作
1. 完成接地和电源走线闭合
2. 清理 ERC 和原理图差异
3. 验证封装钻孔尺寸
4. 下一次布线后重新运行 DRC
