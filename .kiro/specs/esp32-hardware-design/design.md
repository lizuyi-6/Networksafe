# Design: AetherGuard ESP32 物理确认门 — 硬件设计

## Overview

AetherGuard ESP32 物理确认门是整个安全平台的核心差异化组件。其设计原则是：**即使服务器软件层完全沦陷，攻击者也无法在没有人肉身在场的情况下触发高危操作**。

本文档覆盖从原型跳线板到量产 PCB 的完整硬件设计，包括：

1. **High-Level Design**：系统架构、组件选型、PCB 板材规格、电路模块划分
2. **Low-Level Design**：原理图关键电路、PCB 布局建议、元器件清单（BOM）、引脚分配表

---

## High-Level Design

### 1.1 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    AetherGuard ESP32 物理确认门                   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   ESP32-WROOM-32 模组                     │  │
│  │                                                          │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │  │
│  │  │  UART0   │  │  UART2   │  │   I2C    │  │  GPIO  │  │  │
│  │  │ (调试/烧录)│  │ (部署链路)│  │ (OLED)  │  │(按键/LED)│  │  │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │  │
│  └───────┼─────────────┼─────────────┼─────────────┼───────┘  │
│          │             │             │             │           │
│    USB-C/Micro    CP2102 模块    SSD1306 OLED   按键×3         │
│    (板载 USB)    (GPIO16/17)    (GPIO21/22)   RGB LED          │
│                  ↕ UART 串口                   蜂鸣器           │
│              Linux 宿主机                                       │
│           (aetherguard-serial-helper)                          │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 通信协议架构

```
宿主机 (Linux)                    ESP32
    │                               │
    │  AG:REQ:ENV ──────────────▶  │  检测宿主机环境
    │  ◀────────────── AG:ENV:LINUX │
    │                               │
    │  AG:REQ:BACKUP ───────────▶  │  请求备份
    │  ◀──────── AG:BEGIN:BACKUP   │  开始
    │  ◀──────── AG:STEP:xx%       │  进度
    │  ◀──────── AG:OK:BACKUP      │  完成
    │                               │
    │  AG:REQ:INSTALL ──────────▶  │  请求安装（需人工按 OK 键）
    │  ◀──────── AG:BEGIN:INSTALL  │
    │  ◀──────── AG:STEP:xx%       │
    │  ◀──────── AG:OK:INSTALL     │
    │                               │
    │  AG:REQ:REMOVE ───────────▶  │  请求卸载（需人工按 OK 键确认）
    │  ◀──────── AG:ERR:REMOVE     │  若用户拒绝
```

### 1.3 组件选型

| 组件 | 型号 | 规格 | 选型理由 |
|------|------|------|---------|
| 主控 | ESP32-WROOM-32E | 240MHz 双核, 4MB Flash, 520KB SRAM, Wi-Fi+BT | 成熟生态，PlatformIO 支持完善，内置 USB-Serial |
| 显示屏 | SSD1306 OLED | 0.96", 128×64, I2C, 3.3V | 低功耗，无需背光驱动，I2C 节省引脚 |
| 按键 | 6×6mm 轻触开关 | 额定 50mA/12V，寿命 100,000 次 | 标准封装，易于 PCB 布局 |
| RGB LED | 共阴极 5mm RGB | 正向电压 R:2.0V G/B:3.0V | 固件已适配共阴极逻辑 |
| 蜂鸣器 | 有源蜂鸣器模块 | 3.3V，低电平触发，85dB | 无需 PWM，固件直接驱动 |
| USB-Serial | CH340C / CP2102 | USB 2.0 Full Speed，3.3V TTL | 板载集成，替代外部 CP2102 跳线 |
| 稳压器 | AMS1117-3.3 | 1A，LDO，SOT-223 | 5V USB 输入转 3.3V，ESP32 标准方案 |
| 滤波电容 | 100nF + 10μF | MLCC + 电解 | 电源去耦，防止 ESP32 Wi-Fi 发射时电压跌落 |

### 1.4 PCB 板材规格

| 参数 | 规格 | 说明 |
|------|------|------|
| 板材 | FR-4 | 标准玻璃纤维环氧树脂，Tg ≥ 130°C |
| 层数 | 2 层 | 顶层信号 + 底层地平面，成本最优 |
| 板厚 | 1.6mm | 标准厚度，适配常见外壳 |
| 铜厚 | 1 oz (35μm) | 标准铜厚，满足 500mA 电流需求 |
| 表面处理 | HASL（无铅）/ ENIG | HASL 成本低；ENIG 焊接质量更好，推荐量产用 |
| 阻焊 | 绿色 / 黑色 | 双面阻焊，防焊桥 |
| 丝印 | 白色 | 双面丝印，标注引脚和极性 |
| 最小线宽/间距 | 0.15mm / 0.15mm | 满足 JLC 标准工艺 |
| 最小过孔 | 0.3mm 钻孔 / 0.6mm 焊盘 | 标准过孔，无需激光孔 |
| 板尺寸 | 80mm × 55mm（推荐） | 适配 85×55mm 名片盒外壳 |
| 外形 | 矩形，四角 R2mm 圆角 | 防止划手，适配标准外壳 |

### 1.5 电路模块划分

```
┌─────────────────────────────────────────────────────┐
│                    PCB 功能分区                       │
│                                                     │
│  ┌─────────────┐  ┌──────────────────────────────┐  │
│  │  电源模块    │  │        ESP32 核心区           │  │
│  │  USB-C 接口  │  │   ESP32-WROOM-32E 模组       │  │
│  │  AMS1117-3.3 │  │   去耦电容阵列               │  │
│  │  滤波电容    │  │   BOOT/EN 按键               │  │
│  └─────────────┘  └──────────────────────────────┘  │
│                                                     │
│  ┌─────────────┐  ┌──────────────────────────────┐  │
│  │  用户交互区  │  │        通信接口区             │  │
│  │  OLED 显示屏 │  │   板载 CH340C USB-Serial     │  │
│  │  OK/Next/Back│  │   UART2 扩展排针（部署链路）  │  │
│  │  RGB LED     │  │   调试 UART0 排针            │  │
│  │  蜂鸣器      │  │                              │  │
│  └─────────────┘  └──────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## Low-Level Design

### 2.1 引脚分配表

| GPIO | 功能 | 方向 | 外设 | 备注 |
|------|------|------|------|------|
| GPIO1 | UART0 TX | OUT | USB-Serial (CH340C) | 调试/烧录，UART0 |
| GPIO3 | UART0 RX | IN | USB-Serial (CH340C) | 调试/烧录，UART0 |
| GPIO14 | 蜂鸣器 | OUT | 有源蜂鸣器 | 低电平触发，`BUZZER_ACTIVE_LEVEL=LOW` |
| GPIO16 | UART2 RX | IN | UART2 部署链路 | 接 CP2102/宿主机 TX |
| GPIO17 | UART2 TX | OUT | UART2 部署链路 | 接 CP2102/宿主机 RX |
| GPIO18 | 按键 OK | IN | 轻触开关 | `INPUT_PULLUP`，按下接 GND |
| GPIO19 | 按键 Next | IN | 轻触开关 | `INPUT_PULLUP`，按下接 GND |
| GPIO21 | I2C SDA | I/O | SSD1306 OLED | I2C 数据，400kHz Fast Mode |
| GPIO22 | I2C SCL | OUT | SSD1306 OLED | I2C 时钟，400kHz Fast Mode |
| GPIO23 | 按键 Back | IN | 轻触开关 | `INPUT_PULLUP`，按下接 GND |
| GPIO25 | RGB 红 | OUT | RGB LED | 共阴极，高电平点亮 |
| GPIO26 | RGB 绿 | OUT | RGB LED | 共阴极，高电平点亮 |
| GPIO27 | RGB 蓝 | OUT | RGB LED | 共阴极，高电平点亮 |
| GPIO0 | BOOT | IN | BOOT 按键 | 低电平进入下载模式，板载按键 |
| EN | 复位 | IN | EN/RESET 按键 | 低电平复位，板载按键 |

> **GPIO 选型原则**：按键使用 GPIO18/19/23，避开 GPIO0/2/5/12/15 等 strapping 引脚，防止按住按键时影响启动模式。

### 2.2 电源电路

```
USB-C (5V)
    │
    ├── 100μF/10V 电解电容（输入滤波）
    │
    ▼
AMS1117-3.3 (SOT-223)
    │ IN: 5V    OUT: 3.3V
    ├── 10μF 电解电容（输出滤波）
    ├── 100nF MLCC（高频去耦）
    │
    ▼
3.3V 电源轨
    ├── ESP32-WROOM-32E VCC
    │     ├── 100nF × 4（每个 VCC 引脚就近放置）
    │     └── 10μF × 1（模组附近）
    ├── SSD1306 OLED VCC
    ├── RGB LED（通过限流电阻）
    └── 蜂鸣器 VCC

电流预算：
  ESP32 峰值（Wi-Fi TX）：~500mA
  OLED：~20mA
  RGB LED（全亮）：~60mA（每色 20mA）
  蜂鸣器：~30mA
  总计峰值：~610mA（AMS1117-3.3 额定 1A，满足需求）
```

### 2.3 串口电路（UART0 + UART2）

```
板载 CH340C（替代外部 CP2102）：

USB-C D+/D- ──▶ CH340C ──▶ GPIO1 (UART0 RX)
                        ──▶ GPIO3 (UART0 TX)
                        ──▶ 3.3V（CH340C VCC，通过 100nF 去耦）

UART2 部署链路（对外排针 J1）：

J1-1: GND
J1-2: GPIO16 (RX2) ──── 宿主机 TX（或外部 CP2102 TXD）
J1-3: GPIO17 (TX2) ──── 宿主机 RX（或外部 CP2102 RXD）
J1-4: 3.3V（可选，供外部模块参考，不驱动）

注意：J1 排针不提供 5V，防止反向供电损坏 ESP32。
波特率：115200，8N1，3.3V TTL 逻辑电平。
```

### 2.4 OLED 显示电路

```
SSD1306 0.96" I2C OLED：

ESP32 GPIO21 (SDA) ──[4.7kΩ 上拉至 3.3V]── OLED SDA
ESP32 GPIO22 (SCL) ──[4.7kΩ 上拉至 3.3V]── OLED SCL
3.3V ──────────────────────────────────── OLED VCC
GND ───────────────────────────────────── OLED GND

I2C 地址：0x3C（OLED 模块 SA0 引脚接 GND）
时钟频率：400kHz（Fast Mode，固件配置 DISPLAY_I2C_CLOCK_HZ=400000）
上拉电阻：4.7kΩ（400kHz 时推荐值，PCB 走线 < 30cm）
```

### 2.5 按键电路

```
三个按键采用相同电路（以 OK 键为例）：

GPIO18 ──┬── 10kΩ 上拉（ESP32 内部 INPUT_PULLUP，无需外部电阻）
         │
         └── SW_OK（轻触开关一端）
                    │
                   GND（轻触开关另一端）

消抖：固件软件消抖（button_handler.h），无需硬件 RC 滤波。
布局：三个按键并排，间距 ≥ 10mm，防止误触。
```

### 2.6 RGB LED 电路

```
共阴极 RGB LED（5mm 直插或 0805 贴片）：

GPIO25 ──[R_R]── LED 红阳极
GPIO26 ──[R_G]── LED 绿阳极
GPIO27 ──[R_B]── LED 蓝阳极
                 LED 公共阴极 ── GND

限流电阻计算（3.3V 电源，目标电流 10mA）：
  红色：Vf ≈ 2.0V，R = (3.3 - 2.0) / 0.010 = 130Ω → 选 150Ω
  绿色：Vf ≈ 3.0V，R = (3.3 - 3.0) / 0.010 = 30Ω  → 选 33Ω
  蓝色：Vf ≈ 3.0V，R = (3.3 - 3.0) / 0.010 = 30Ω  → 选 33Ω

封装推荐：0805 贴片电阻，便于 PCB 自动贴片。
```

### 2.7 蜂鸣器电路

```
有源蜂鸣器（低电平触发，3.3V，85dB）：

GPIO14 ──[1kΩ]── NPN 三极管 B 极（S8050 或 2N2222）
                 NPN C 极 ── 蜂鸣器负极
                 NPN E 极 ── GND
3.3V ──────────── 蜂鸣器正极
                 [100Ω 串联保护电阻可选]

说明：
- 固件配置 BUZZER_ACTIVE_LEVEL=LOW，GPIO14 低电平时蜂鸣器响
- 使用 NPN 三极管驱动，避免 GPIO 直接驱动蜂鸣器（蜂鸣器启动电流可达 30mA，超过 GPIO 安全电流 12mA）
- 基极限流电阻 1kΩ，确保三极管饱和导通
- 续流二极管（1N4148）并联在蜂鸣器两端，防止感性负载反向电动势损坏三极管
```

### 2.8 PCB 布局建议

```
布局优先级（从高到低）：

1. 电源去耦电容：紧贴 ESP32 模组 VCC 引脚，走线 < 5mm
2. AMS1117-3.3：靠近 USB-C 接口，散热焊盘连接底层铜皮
3. CH340C：靠近 USB-C 接口，USB D+/D- 差分对等长走线
4. OLED 接口：靠近板边，方便外壳开窗
5. 按键：靠近板边，三键并排，间距 10mm
6. RGB LED：靠近板边，方便外壳开孔
7. 蜂鸣器：远离 OLED 和按键，防止振动干扰

走线规则：
- 电源走线宽度：≥ 0.5mm（3.3V 主干），≥ 1.0mm（5V USB 输入）
- 信号走线宽度：0.2mm（I2C、UART、GPIO）
- GND 铺铜：底层全铺 GND，顶层信号区域外铺 GND
- I2C 走线：SDA/SCL 平行走线，间距 ≥ 0.2mm，长度 < 50mm
- UART2 走线：TX/RX 平行走线，靠近 J1 排针
- USB D+/D-：差分对，等长走线，间距 0.2mm，避免直角
- 过孔：信号过孔 0.3mm 钻孔，电源过孔 0.5mm 钻孔
```

### 2.9 元器件清单（BOM）

| 位号 | 描述 | 型号/规格 | 数量 | 封装 | 备注 |
|------|------|-----------|------|------|------|
| U1 | ESP32 主控模组 | ESP32-WROOM-32E (4MB) | 1 | 模组 | 核心主控 |
| U2 | USB-Serial 转换 | CH340C | 1 | SOP-16 | 板载串口，替代外部 CP2102 |
| U3 | LDO 稳压器 | AMS1117-3.3 | 1 | SOT-223 | 5V→3.3V，1A |
| D1 | OLED 显示屏 | SSD1306 0.96" I2C | 1 | 模组 | 128×64，I2C 地址 0x3C |
| LED1 | RGB LED | 共阴极 5mm / 0805 | 1 | 5mm 直插 | 状态指示 |
| BZ1 | 有源蜂鸣器 | 3.3V，低电平触发 | 1 | 直插 | 操作音效 |
| Q1 | NPN 三极管 | S8050 / 2N2222 | 1 | SOT-23 | 蜂鸣器驱动 |
| SW1 | 按键 OK | 6×6mm 轻触开关 | 1 | 直插/贴片 | 确认操作 |
| SW2 | 按键 Next | 6×6mm 轻触开关 | 1 | 直插/贴片 | 切换选项 |
| SW3 | 按键 Back | 6×6mm 轻触开关 | 1 | 直插/贴片 | 返回/取消 |
| SW4 | BOOT 按键 | 6×6mm 轻触开关 | 1 | 直插/贴片 | 固件烧录 |
| SW5 | EN/RESET 按键 | 6×6mm 轻触开关 | 1 | 直插/贴片 | 硬件复位 |
| J1 | UART2 排针 | 2.54mm 4P 排针 | 1 | 直插 | 部署链路扩展 |
| J2 | USB-C 接口 | USB Type-C 16P | 1 | 贴片 | 供电+调试 |
| C1 | 输入滤波电容 | 100μF/10V 电解 | 1 | 径向 5mm | USB 输入滤波 |
| C2 | 输出滤波电容 | 10μF/10V 电解 | 1 | 径向 5mm | LDO 输出滤波 |
| C3-C6 | ESP32 去耦电容 | 100nF MLCC | 4 | 0402 | 每 VCC 引脚一个 |
| C7 | ESP32 大容量去耦 | 10μF MLCC | 1 | 0805 | Wi-Fi 发射去耦 |
| C8 | CH340C 去耦 | 100nF MLCC | 1 | 0402 | USB-Serial 去耦 |
| R1 | I2C SDA 上拉 | 4.7kΩ | 1 | 0402 | OLED I2C |
| R2 | I2C SCL 上拉 | 4.7kΩ | 1 | 0402 | OLED I2C |
| R3 | RGB 红限流 | 150Ω | 1 | 0402 | LED 红色通道 |
| R4 | RGB 绿限流 | 33Ω | 1 | 0402 | LED 绿色通道 |
| R5 | RGB 蓝限流 | 33Ω | 1 | 0402 | LED 蓝色通道 |
| R6 | 蜂鸣器基极限流 | 1kΩ | 1 | 0402 | Q1 基极 |
| D2 | 续流二极管 | 1N4148 | 1 | SOD-123 | 蜂鸣器保护 |

**估算成本（单板，JLC 打样）**：
- PCB 打样（5 片）：约 ¥30
- 元器件（单板）：约 ¥45（ESP32 模组 ¥18 + 其余 ¥27）
- 合计单板成本：约 ¥75（不含人工）

### 2.10 固件与硬件接口对照

固件 `config.h` 中的宏定义与 PCB 引脚的对应关系：

```cpp
// 以下宏定义与 PCB 设计严格对应，修改 PCB 时需同步更新 config.h

#define PIN_I2C_SDA     21   // OLED SDA → GPIO21
#define PIN_I2C_SCL     22   // OLED SCL → GPIO22
#define PIN_BTN_OK      18   // OK 按键  → GPIO18（非 strapping 引脚）
#define PIN_BTN_NEXT    19   // Next 按键 → GPIO19（非 strapping 引脚）
#define PIN_BTN_BACK    23   // Back 按键 → GPIO23（非 strapping 引脚）
#define PIN_RGB_RED     25   // RGB 红   → GPIO25
#define PIN_RGB_GREEN   26   // RGB 绿   → GPIO26
#define PIN_RGB_BLUE    27   // RGB 蓝   → GPIO27
#define RGB_COMMON_ANODE 0   // 共阴极   → PCB 使用共阴极 RGB
#define PIN_BUZZER      14   // 蜂鸣器   → GPIO14（通过 Q1 驱动）
#define BUZZER_ACTIVE_LEVEL LOW  // 低电平触发 → Q1 导通时蜂鸣器响
#define TARGET_RX_PIN   16   // UART2 RX → GPIO16（接 J1-2）
#define TARGET_TX_PIN   17   // UART2 TX → GPIO17（接 J1-3）
#define TARGET_BAUD     115200   // 波特率 → J1 排针通信速率
```

### 2.11 生产测试点

PCB 上应预留以下测试点（TP），便于生产测试和调试：

| 测试点 | 网络 | 用途 |
|--------|------|------|
| TP1 | 3.3V | 电源电压验证 |
| TP2 | GND | 接地参考 |
| TP3 | GPIO16 (RX2) | UART2 接收信号 |
| TP4 | GPIO17 (TX2) | UART2 发送信号 |
| TP5 | GPIO1 (UART0 TX) | 调试串口输出 |
| TP6 | GPIO3 (UART0 RX) | 调试串口输入 |

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Power Rail Integrity

For any USB input voltage in the range 4.5 V–5.5 V, the AMS1117-3.3 output rail must remain within ±5% (3.135 V–3.465 V), and the voltage difference between any two ESP32 VCC pins must be less than 50 mV.

> **Note:** This is a hardware measurement property verified by bench instrumentation on the physical PCB, not by software property-based testing.

**Validates: Requirements 1.2, 1.7**

---

### Property 2: Button Debounce Correctness

*For any* sequence of GPIO level transitions on a single button input that occur within a 50 ms window, the firmware debounce logic shall register exactly one button event — regardless of how many raw transitions occurred within that window.

**Validates: Requirements 7.5**

---

### Property 3: UART2 Transmission Integrity

*For any* AG protocol message of length 1–2048 bytes transmitted over UART2 at 115200 baud (3.3 V TTL, trace length < 100 mm), the byte sequence received at the far end shall be identical to the byte sequence that was sent — in both the host-to-device and device-to-host directions.

**Validates: Requirements 4.4, 4.5**

---

### Property 4: RGB Colour Exclusivity

*For any* `LEDColor` enum value defined in the firmware, calling `applyColor()` shall set the three RGB GPIO output levels to exactly the combination specified by that colour definition, with no intermediate states and no spurious activation of channels not required by the colour definition.

**Validates: Requirements 8.5, 8.6**

---

### Property 5: AG Protocol Response Sequence

*For any* `AG:REQ:BACKUP` operation executed by the firmware, the sequence of messages emitted on UART2 shall conform to the pattern: exactly one `AG:BEGIN:BACKUP`, followed by one or more `AG:STEP:<percent>` messages with monotonically non-decreasing percent values, followed by exactly one `AG:OK:BACKUP` — with no other message types interspersed.

**Validates: Requirements 5.2, 5.7**

---

### Property 6: Physical Confirmation Security Invariant

*For any* `AG:REQ:INSTALL` or `AG:REQ:REMOVE` message received by the firmware, the firmware shall never emit `AG:BEGIN:INSTALL` or `AG:BEGIN:REMOVE` unless a physical OK button press event has been registered after the request was received and before the response is sent.

**Validates: Requirements 5.3, 5.4, 5.8**

---

## 交付检查清单

- [ ] PCB 原理图完成，所有引脚与 `config.h` 宏定义一致
- [ ] PCB 布局完成，电源去耦电容紧贴 ESP32 VCC 引脚
- [ ] Gerber 文件生成，通过 JLC 设计规则检查（DRC）
- [ ] BOM 导出，所有元器件有 JLC 备货型号
- [ ] 打样 5 片，完成基本功能验证（上电、OLED 显示、按键、RGB、蜂鸣器、UART2）
- [ ] 固件烧录验证：`pio run -e serial_deployer_release` 成功烧录并运行
- [ ] 部署链路验证：连接 Linux 宿主机，收到 `AG:ENV:LINUX` 响应
- [ ] P1–P4 属性测试通过
