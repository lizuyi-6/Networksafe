# 硬件方案文档校对 Spec

## Why
硬件方案文档存在多处版本标记、技术规格和文档间一致性问题，需要系统性校对以确保文档准确性，避免误导工程师和生产人员。

## What Changes
- 核查各硬件文档间的版本号一致性
- 验证技术规格参数（尺寸、GPIO映射、接口定义）的准确性和一致性
- 检查中英文文档的对应关系
- 标识过时或冲突的内容
- 提出修正建议

## Impact
- Affected specs: 硬件设计规格文档
- Affected code: 
  - `docs/硬件设计方案书.md`
  - `docs/硬件设计亮点.md`
  - `docs/硬件外壳设计规范.md`
  - `docs/hardware_shell_spec.md`
  - `docs/plans/2026-03-14-esp32-serial-deployer-wiring-design.md`
  - `docs/adr/2026-03-14-esp32-serial-deployer-wiring-baseline.md`
  - `deployment/esp32-serial-deployer-bundle/WIRING.md`
  - `deployment/esp32-serial-deployer-bundle/README.md`
  - `hardware/kicad/esp32-serial-deployer-pcb/README.md`

## ADDED Requirements

### Requirement: 版本一致性检查
系统应确保所有活跃硬件文档的版本号、日期和状态标记保持一致。

#### Scenario: 中英文外壳规格一致性
- **WHEN** 检查 `硬件外壳设计规范.md` 和 `hardware_shell_spec.md`
- **THEN** 两文档的版本号、尺寸规格、接口定义应完全对应

#### Scenario: 历史文档归档标记
- **WHEN** 检查 `硬件设计方案书.md`
- **THEN** 应确认归档警告清晰可见，当前生产基线指向 `hardware_shell_spec.md`

### Requirement: 技术规格一致性
系统应确保 GPIO 映射、尺寸规格、接口定义在所有文档中保持一致。

#### Scenario: GPIO 映射一致性
- **WHEN** 对比接线文档与 PCB README
- **THEN** GPIO 分配（OLED/按钮/RGB/蜂鸣器/UART）应完全一致

#### Scenario: 外壳尺寸一致性
- **WHEN** 对比各文档中的外壳尺寸
- **THEN** 包络尺寸、PCB 尺寸、开孔尺寸应一致

### Requirement: 文档引用完整性
系统应确保文档间的交叉引用有效且指向正确位置。

#### Scenario: 文件路径引用
- **WHEN** 检查文档中引用的文件路径
- **THEN** 所有引用路径应存在且可访问

### Requirement: 术语一致性
系统应确保专业术语在所有文档中使用一致。

#### Scenario: 组件命名
- **WHEN** 检查各文档的组件命名
- **THEN** 同一组件应使用相同名称（如 LOWER_CHASSIS, UPPER_BEZEL, SERVICE_DOOR, LENS, BUTTON_CAPS）

## MODIFIED Requirements
无（此为校对任务，不涉及功能修改）

## REMOVED Requirements
无

## 校对范围

### 1. 版本与状态标记
| 文档 | 当前版本 | 状态 | 备注 |
|------|---------|------|------|
| 硬件设计方案书.md | v1.0 | 归档参考 | 标记为历史参考 |
| 硬件外壳设计规范.md | v7.0 | 活跃 | 中文版外壳规格 |
| hardware_shell_spec.md | v7.0 | 活跃 | 英文版外壳规格 |
| wiring-design.md | 2026-03-14 | Accepted | 接线计划 |
| wiring-baseline ADR | 2026-03-14 | Accepted | 架构决策记录 |

### 2. 技术规格校对项
- [ ] 外壳包络尺寸：90 x 58 x 16.8mm
- [ ] PCB 尺寸：52mm x 29mm（面包板原型） / 100mm x 72mm（PCB v1）
- [ ] GPIO 映射：OLED(21/22)、按钮(18/19/23)、RGB(25/26/27)、蜂鸣器(14)、UART2(16/17)
- [ ] OLED 窗口：23 x 12mm
- [ ] 顶窗外观：81 x 47mm
- [ ] 按键中心距：12mm
- [ ] Type-C 开孔：9 x 4mm

### 3. 文档关系校对
- [ ] 中英文外壳规格是否对应
- [ ] 接线文档与 PCB README GPIO 是否一致
- [ ] 部署包文档与主线文档是否同步

### 4. 预期输出
- 校对报告：列出发现的问题
- 修正建议：针对每个问题提供具体修改方案
