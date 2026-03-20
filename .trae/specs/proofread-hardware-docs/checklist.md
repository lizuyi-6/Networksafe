# 硬件方案文档校对 Checklist

## 版本与状态

- [x] `硬件外壳设计规范.md` 版本为 v7.0
- [x] `hardware_shell_spec.md` 版本为 v7.0
- [x] 两份外壳规格版本号一致
- [x] `硬件设计方案书.md` 包含明确的归档警告

## 尺寸规格

- [x] 外壳包络尺寸：90 x 58 x 16.8mm（中外壳规格一致）
- [x] PCB 基线尺寸：52mm x 29mm（外壳规格）
- [x] PCB v1 尺寸：100mm x 72mm（PCB README）
- [x] OLED 窗口：23 x 12mm（中外壳规格一致）
- [x] 顶窗外观：81 x 47mm（中外壳规格一致）
- [x] 按键中心距：12mm（中外壳规格一致）
- [x] Type-C 开孔：9 x 4mm（中外壳规格一致）
- [x] RGB 透光：3.0mm（中外壳规格一致）

## GPIO 映射

- [x] OLED SDA = GPIO21（WIRING.md / PCB README 一致）
- [x] OLED SCL = GPIO22（WIRING.md / PCB README 一致）
- [x] Button OK = GPIO18（WIRING.md / PCB README 一致）
- [x] Button Next = GPIO19（WIRING.md / PCB README 一致）
- [x] Button Back = GPIO23（WIRING.md / PCB README 一致）
- [x] RGB R = GPIO25（WIRING.md / PCB README 一致）
- [x] RGB G = GPIO26（WIRING.md / PCB README 一致）
- [x] RGB B = GPIO27（WIRING.md / PCB README 一致）
- [x] Buzzer = GPIO14（WIRING.md / PCB README 一致）
- [x] Host UART RX = GPIO16（WIRING.md / PCB README 一致）
- [x] Host UART TX = GPIO17（WIRING.md / PCB README 一致）

## 组件命名

- [x] LOWER_CHASSIS 命名一致（中外壳规格）
- [x] UPPER_BEZEL 命名一致（中外壳规格）
- [x] SERVICE_DOOR 命名一致（中外壳规格）
- [x] LENS 命名一致（中外壳规格）
- [x] BUTTON_CAPS 命名一致（中外壳规格）
- [ ] ASSEMBLY 命名 - 中文版缺失（⚠️ 警告）
- [ ] PLATE 命名 - 中文版缺失（⚠️ 警告）

## 文档引用

- [x] WIRING.md 引用的图片 `assets/esp32-prototype-breadboard.png` 存在
- [x] 外壳规格引用的 `hardware/enclosure.scad` 存在
- [x] 兼容入口文件（chassis.scad 等）存在

## 归档与当前基线

- [x] `硬件设计方案书.md` 归档警告指向正确
- [ ] `硬件设计亮点.md` 缺失归档警告（🔴 需修正）
- [x] 部署包 README 与主线文档同步

## 校对报告

- [x] 所有发现的问题已汇总
- [x] 问题按严重程度分类
- [x] 每个问题有修正建议
- [x] 校对报告已提交给用户
