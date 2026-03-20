# AetherGuard Deployment Dongle - 平顶玻璃黑盒外壳规格

**版本**: v7.0 (Flat-Top Glass Black Box)
**日期**: 2026-03-13
**定位**: USB-TTL 本地串口部署器桌面外壳，不是直插式 USB-A dongle。
**材料基线**: FDM 打印主体 + 1.5mm 烟色透明窗片，不含电池仓。

## 1. 导出接口

`hardware/enclosure.scad` 当前公开导出如下：
- `LOWER_CHASSIS`
- `UPPER_BEZEL`
- `SERVICE_DOOR`
- `LENS`
- `BUTTON_CAPS`
- `ASSEMBLY`
- `PLATE`

兼容入口保留如下：
- `hardware/chassis.scad` -> `LOWER_CHASSIS`
- `hardware/top_plate.scad` -> `UPPER_BEZEL`
- `hardware/bottom_cover.scad` -> `SERVICE_DOOR`
- `hardware/lens.scad` -> `LENS`
- `hardware/button_caps.scad` -> `BUTTON_CAPS`

## 2. 总体包络

| 项目 | 尺寸 |
| :--- | :--- |
| 总长 | `90mm` |
| 总宽 | `58mm` |
| 总高 | `16.8mm` |
| PCB 基线 | `52mm x 29mm` |
| 顶窗外观尺寸 | `81mm x 47mm` |
| 推荐内部净高 | `>= 11mm` |

## 3. 当前结构定义

### LOWER_CHASSIS
- 作为内托盘，负责 PCB 基准、压线柱、安装管柱和底部检修结构。
- 所有安装柱、门锁柱和压线结构都必须被外观壳遮蔽，不得主导外观。

### UPPER_BEZEL
- 承担完整平顶黑盒外观表皮、整块顶窗面框、前侧浅凹按钮带和后部 I/O 控制。
- 从常规前 3/4 视角必须读成低矮桌面黑盒，而不是楔形设备或平板叠放。

### SERVICE_DOOR
- 采用底部隐藏式螺丝固定，仅出现在底面。
- 门缝不得延伸到侧面或正面。

### LENS
- 1.5mm 烟色 PC/亚克力插片。
- 统一覆盖 OLED 与 RGB 视觉区域，形成单块玻璃盖板观感。

### BUTTON_CAPS
- 3 个独立低矮按钮帽。
- 位于前侧长边操作带，中心距 `12mm`。

## 4. 面板与接口硬尺寸

建议打印补偿统一按 `+0.2mm` 处理。

| 组件 | 目标尺寸 | 说明 |
| :--- | :--- | :--- |
| OLED 实际可视窗口 | `23.0mm x 12.0mm` | 隐藏在统一顶窗后方 |
| RGB 透光窗口 | `3.0mm` | 隐藏在统一顶窗后方 |
| 顶窗外观尺寸 | `81.0mm x 47.0mm` | 当前主视觉面板 |
| 按键中心距 | `12.0mm` | 三键横向排列于前侧 |
| Type-C 开孔 | `9.0mm x 4.0mm` | 后侧居中 |
| 主机出线 | `3.2mm - 3.8mm` 线径 | 右侧后下切口引出 |
| 蜂鸣器出音孔 | `3 x 1.5mm` | 位于底部前缘/底面 |

## 5. 装配基线

- 顶盖与内托盘采用隐藏式 `M2` 螺丝 + 热熔铜柱固定，不允许顶部露螺丝。
- PCB 继续按 `52mm x 29mm` 基线布局，保留 4 个支撑柱和边界定位挡块。
- OLED 背面设置矩形支撑台阶，保证视窗居中。
- 三颗按键位于前侧长边独立操作带，通过导向套与低矮按钮帽回位。
- 右侧后下短线必须通过下凹切口和压线柱缓冲，不得退化成大号直槽。

## 6. 打印与结构验证

- 主体件默认按“少支撑或无支撑”方向建模。
- `ASSEMBLY` 用于装配检查；打印导出优先使用单件或 `PLATE`。
- 首批结构验证重点：
  - 透明窗插装不翘边。
  - 短线拉拽后出线口不割伤线皮。
  - Type-C 与按钮中心线对位。
  - 20 次拆装后热熔铜柱区无裂纹。

## 7. 视觉验收输出

- 视觉验收必须先于结构验收进行，不能只以 STL 可导出作为完成标准。
- 标准输出图仍沿用兼容文件名：
  - `hardware/renders/desk_wedge_front34.png`
  - `hardware/renders/desk_wedge_side.png`
  - `hardware/renders/desk_wedge_top.png`
  - `hardware/renders/desk_wedge_plate.png`
- 验收标准：
  - 前 3/4 视图必须先读成“低矮黑盒 + 整块顶窗”。
  - 顶窗必须是第一视觉中心，OLED 与 RGB 不得被读成独立外露孔位。
  - 三键必须位于前侧长边，存在感弱于顶窗。
  - 右侧后下出线必须可见但克制，不得出现粗暴大开槽。
