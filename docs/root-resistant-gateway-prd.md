# AetherGuard Root-Resistant Gateway Appliance PRD

> 版本：v0.2  
> 日期：2026-06-11  
> 阶段：硬件可信原型 / 企业 PoC  
> 产品方向：自研工业级 Root-Resistant Gateway Appliance（多网口网关 + 独立安全授权控制器 + Secure Element / TPM + 硬件级 fail-closed interlock）  
> 变更说明：v0.2 起，原 ESP32 硬件信任根方案全面退役，由自研 AetherGuard Root-Resistant Gateway Appliance 替代。

---

## 1. 产品概述

### 1.1 产品名称

**AetherGuard Root-Resistant Gateway Appliance**

中文定位：

> **AetherGuard 根权限抵抗型最终防线网关一体机**

简称：

> **AetherGuard Gateway Appliance** 或 **AG Appliance**

### 1.2 一句话定位

> AetherGuard Root-Resistant Gateway Appliance 是部署在关键服务器外部的自研工业级硬件最后防线一体机，用于在服务器失陷后继续控制关键网络释放。

### 1.3 核心主张

> AetherGuard 把关键网络释放权从被保护服务器的软件系统中移出，交给外部独立的自研硬件安全一体机执行。

更适合路演的表达：

> **AetherGuard 把服务器的最后一道网络开关，放到服务器外面——用一台自研的硬件安全一体机。**

技术表达：

> 即使受保护服务器被攻击者获取 root 权限，攻击者也不能仅凭该服务器自身权限恢复 SERVER ↔ LAN/WAN 的关键网络连接。最终 release 必须经过 AetherGuard Gateway Appliance 的工业多网口网关、独立 STM32H5/U5 安全授权控制器、Secure Element / TPM、策略 digest、单调计数器、有效期、物理确认或授权流程，以及硬件级 fail-closed interlock feedback 校验。

### 1.4 硬件代际演进

本 Appliance 全面替代此前的 ESP32 硬件方案：

| 维度 | 前代方案（已退役） | 当前方案（Appliance） |
| --- | --- | --- |
| 硬件形态 | ESP32-WROOM-32 串口部署 dongle / ESP32-S3 控制板 | 工业级多网口网关一体机 |
| 网络能力 | 无（仅 USB-TTL 串口） | 双 1GbE 数据口 + 独立 MGMT 口 + 可选蜂窝 |
| 安全控制器 | ESP32-S3（通用 MCU） | STM32H5/U5 专用安全 MCU |
| 安全芯片 | ATECC608C（单一选型） | OPTIGA Trust M / SE050 / ATECC608B / STSAFE-A110（多选型兼容） |
| 隔离机制 | 软件管理链路隔离 | 硬件级 fail-closed interlock + 物理 relay + feedback 闭环 |
| 信任根 | ESP32 内部 flash | 独立 Secure Element（私钥不可导出）+ 可选 TPM 2.0 |
| 数据平面控制 | 无 | SERVER ↔ LAN/WAN 透明 L2 桥接 / 防火墙 |
| 产品化程度 | 跳线原型 / 开发板 | 工业网关 + 安全控制板 + DIN-rail 集成 |

---

## 2. 宣传口径调整

### 2.1 原口径风险

原先偏向：

> AetherGuard 自研硬件，实现完全最后防线。

该口径有三个风险：

1. **容易被追问硬件成熟度**：PCB、EMC、安规、量产、供应链、工厂测试是否完成。
2. **“完全最后防线”容易被理解为绝对防御**：容易被质疑过度承诺。
3. **把重点放错在“自研硬件”而非“安全边界重构”**：真正创新点是把最终授权边界移出服务器。

### 2.2 新推荐口径

建议统一改为：

> **AetherGuard 是面向服务器失陷场景的 Root-resistant Final Defense 平台。它通过外部网络隔离网关、独立安全授权控制器和硬件信任根，把关键网络释放权从服务器软件中移出，实现可验证、可审计、默认隔离的最后防线。**

### 2.3 “完全最后防线”的工程定义

建议保留“完全最后防线”作为品牌表达，但必须附带工程定义：

> **“完全最后防线”不是指系统永远不会被攻破，而是指在服务器软件已经不可信的情况下，关键网络释放权仍由服务器外部的硬件安全边界执行，并且该状态可检测、可审计、可 fail-closed。**

### 2.4 面向不同对象的话术

#### 面向评委 / 路演

> AetherGuard 解决的是服务器被入侵后的最后防线问题。传统 EDR、防火墙和自动化运维工具都运行在可被攻破的软件环境里，一旦攻击者拿到 root，许多防护会失效。AetherGuard 的 Root-resistant Final Defense 把最终网络释放权移到服务器外部，通过工业多网口网关、独立 STM32 安全控制器、Secure Element 和硬件 interlock，实现默认隔离、硬件授权、状态反馈和全链路审计。

#### 面向企业客户

> AetherGuard 不替代现有防火墙、EDR 或堡垒机，而是在关键服务器外增加一层可审计的硬件最后防线。服务器被入侵后，攻击者不能仅凭主机 root 权限恢复生产网络连接。网络释放必须经过外部网关、本地策略、硬件身份、单调计数器、有效期、物理确认或授权流程，以及 interlock feedback 校验。

#### 面向技术评审

> 当前原型采用工业多网口 x86/ARM 网关承担 SERVER、LAN/WAN、MGMT 三平面隔离；STM32H5/U5 安全控制器承担最终授权状态机；OPTIGA Trust M / ATECC608 / SE050 等 Secure Element 保护设备私钥；硬件 interlock 和 feedback 输入用于实现 fail-closed。Linux 网关只能请求释放，不能单方面决定释放。后续量产版本可将控制器、Secure Element、隔离 IO 和网关联动机制收敛为一体化硬件。

### 2.5 禁用宣传话术

禁止或避免使用：

- 绝对安全
- 永不失陷
- 无法绕过
- 完全防勒索
- 替代防火墙 / EDR
- 自研硬件已经量产
- 通过所有安全认证
- 任何 root 攻击都无效

建议替换为：

- 面向服务器失陷后的最后防线
- 降低 root 攻击者恢复网络连接的能力
- 最终释放权移出被保护服务器
- 默认隔离，授权释放，异常回落
- 可检测、可审计、可验证
- 当前为工业硬件原型，后续可产品化为一体化设备

---

## 3. 背景与问题

传统服务器安全产品主要运行在被保护服务器内部或同一软件信任边界中，例如 Agent、EDR、WAF、自动化脚本、运维平台等。

当攻击者获得服务器 root 权限后，可能出现：

1. 停止安全 Agent；
2. 篡改日志；
3. 修改本机防火墙规则；
4. 绕过本机隔离策略；
5. 伪造健康状态；
6. 重新打开网络连接；
7. 执行破坏性运维操作。

AetherGuard 的 Final Defense Mode 目标不是阻止所有入侵，而是在**入侵已发生后**提供一条外部、可审计、默认隔离的硬件最后防线。

本版本将硬件路线从“自研单板优先”调整为：

> **工业多网口网关 + 独立安全授权控制器 + Secure Element + 硬件 interlock 的组合式原型。**

这样可以更快验证安全模型，同时更适合企业 PoC 和路演展示。

---

## 4. 产品定位

### 4.1 产品是什么

AetherGuard Root-Resistant Gateway Appliance 是：

- 部署在服务器外部的网络隔离边界；
- 默认 fail-closed 的外部网关；
- 具有独立 MGMT 通道的安全控制点；
- 由 Secure Element 和安全 MCU 保护最终授权逻辑的硬件最后防线；
- 能把状态、授权、反馈、审计上传到 AetherGuard 控制平面的安全设备。

### 4.2 产品不是什么

AetherGuard Root-Resistant Gateway Appliance 不是：

- 传统防火墙的替代品；
- EDR 的替代品；
- 普通 OpenWrt 路由器；
- 单纯的远程继电器；
- 承诺永不被攻破的绝对安全设备。

---

## 5. 目标用户与核心场景

### 5.1 目标用户

| 用户 | 需求 |
| --- | --- |
| 安全负责人 / CISO | 降低关键服务器被 root 后的横向移动和持续破坏风险 |
| 运维负责人 | 高危操作需要硬件授权、审计和回落机制 |
| IDC / 私有云团队 | 对关键物理机、边缘节点、网关节点做外部隔离 |
| 金融 / 工业 / 政企客户 | 需要更强的失陷后控制与证据链 |
| 安全演练 / 红蓝对抗团队 | 验证服务器被攻破后的最后防线能力 |

### 5.2 核心场景

#### 场景 1：服务器被 root 后无法自行恢复外部网络

攻击者拿到服务器 root 权限，试图重新打开网络连接或修改本机防火墙。由于 SERVER ↔ LAN/WAN 的最终连接由外部 AetherGuard Gateway 控制，攻击者无法仅凭服务器权限恢复连接。

#### 场景 2：高危操作必须经过硬件授权

运维平台请求执行：

- `host_remove`
- `wipe_data`
- `factory_reset`
- `recovery_flash`
- `critical_config_change`

AetherGuard 后端可以发起请求，但最终 grant 必须经过安全控制器、Secure Element、策略 digest、counter、expiry、feedback 校验后才可执行。

#### 场景 3：异常时自动 fail-closed

以下情况发生时，系统自动保持或回落到 `isolated`：

- 签名校验失败；
- counter 回滚；
- policyDigest 不匹配；
- grant 过期；
- Secure Element 不可用；
- interlock feedback 不一致；
- board heartbeat 丢失；
- 独立 MGMT 不健康；
- gateway 状态与控制器状态冲突。

#### 场景 4：审计证明“最后防线是否真的有效”

控制平面必须能展示：

- external gateway 是否存在；
- Secure Element 是否已 provision；
- policyDigest 是否匹配；
- firmware digest / attestation 是否有效；
- SERVER 和 LAN/WAN 端口是否在线；
- MGMT 是否独立可达；
- bridge state 是 isolated / armed / released / fault；
- 最后一次 release 的 challenge、counter、expiry 和结果。

---

## 6. 产品目标与非目标

### 6.1 MVP 目标

PoC 阶段实现：

1. 外部多网口网关能控制 SERVER ↔ LAN/WAN 的转发；
2. 默认状态为 isolated；
3. 后端可以请求 release，但不能直接 release；
4. STM32H5/U5 控制器负责最终授权状态机；
5. Secure Element 保护硬件身份或 grant 签名密钥；
6. 支持物理确认按钮；
7. 支持 interlock output 和 feedback input；
8. 状态上报到 AetherGuard 控制平面；
9. UI 能清楚显示是否满足 root-resistant active；
10. 异常时 fail-closed。

### 6.2 非目标

MVP 阶段不做：

1. 自研双千兆以太网硬件板；
2. 完整硬件认证；
3. 量产外壳；
4. 高吞吐硬件转发芯片；
5. FPGA 数据平面；
6. 完整 Secure Boot / Measured Boot 供应链闭环；
7. 所有网关型号适配；
8. 对 out-of-band BMC、Wi-Fi、备用网卡、物理接触攻击做完整覆盖。

---

## 7. 核心价值主张

| 价值 | 说明 |
| --- | --- |
| 失陷后控制 | 假设服务器已被 root，仍保留外部网络隔离能力 |
| 默认安全 | 默认 isolated，释放需要明确授权 |
| 硬件授权 | 高危操作不能只靠后端 API 或主机脚本决定 |
| 可审计 | 每次 release 都有 challenge、counter、signature、feedback |
| 可验证 | UI 展示 root-resistant active 的具体条件 |
| 可集成 | 不替代现有安全产品，可与 EDR、防火墙、堡垒机共存 |

---

## 8. 推荐硬件方案

Appliance 由四大核心硬件模块组成，各模块职责明确、接口清晰：

```text
┌─────────────────────────────────────────────────────────────────┐
│              AetherGuard Root-Resistant Gateway Appliance       │
│                                                                 │
│  ┌─────────────────────┐    ┌──────────────────────────────┐    │
│  │ M1: Multi-port      │    │ M2: Security Authorization   │    │
│  │     Gateway          │◄──►│     Controller               │    │
│  │ (工业多网口网关)     │    │ (独立安全授权控制器)          │    │
│  └──────────┬──────────┘    └──────────┬───────────────────┘    │
│             │                          │                        │
│             │    ┌──────────────┐      │    ┌───────────────┐   │
│             │    │ M3: Secure   │      │    │ M4: Fail-     │   │
│             │    │ Element/TPM  │      │    │ closed        │   │
│             │    │ (安全芯片)   │      │    │ Interlock     │   │
│             │    └──────────────┘      │    │ (硬件级闭锁)  │   │
│             │                          │    └───────────────┘   │
│             │                          │                        │
│  SERVER ◄──►│ bridge ◄──► LAN/WAN     │  relay + feedback       │
│  MGMT   ◄──►│ mgmt   ◄──► Backend     │  button + stack light   │
│             │                          │                        │
└─────────────────────────────────────────────────────────────────┘
```

### 8.1 M1: Multi-port Gateway（工业多网口网关）

**模块定位**：Appliance 的数据平面和管理平面承载平台，运行嵌入式 Linux 操作系统，承担网络桥接/防火墙控制和后端通信。

首选：

```text
Protectli Vault VP2430 / VP2420 / VP4650
```

备选：

```text
OnLogic 工业多网口主机
Moxa 工业网关
Advantech 工控网关
```

硬件要求：

| 参数 | 要求 |
| --- | --- |
| CPU | x86（Intel Celeron / Atom）或 ARM（NXP i.MX8 / Rockchip RK3568） |
| 内存 | ≥ 4 GB DDR4 / DDR5 |
| 存储 | ≥ 32 GB eMMC / NVMe SSD（用于 OS + gateway daemon + 审计日志本地缓存） |
| 网口 | ≥ 3 个物理 GbE RJ45：SERVER、LAN/WAN、MGMT |
| 扩展网口 | 可选 SFP / SFP+ 用于 10G 上联 |
| 蜂窝 | 可选 4G/5G M.2 模块作为 MGMT 冗余通道 |
| TPM | 可选板载 TPM 2.0（用于平台身份度量，与 M3 Secure Element 互补） |
| OS 支持 | Debian 12+ / OpenWrt 23+ / OPNsense / VyOS |
| Watchdog | 硬件 watchdog 支持，firmware 挂死时驱动 bridge 回落到 isolated |
| 供电 | 12V DC 或 19V DC，支持冗余电源输入 |
| 工作温度 | 0°C ~ 50°C（工业级），可选 -20°C ~ 60°C（宽温级） |
| 外形 | 无风扇被动散热，DIN-rail 或 1U 机架安装 |

软件组件：

- **Gateway Daemon**：运行在嵌入式 Linux 上的守护进程，负责：
  - 向 AetherGuard 后端注册自身身份、端口信息、控制器状态和 Secure Element 状态
  - 管理 SERVER ↔ LAN/WAN 的 nftables / iptables 桥接和防火墙规则
  - 通过 serial JSON 协议与 M2 安全控制器通信
  - 只在 interlock released 且 feedback 一致时才打开 bridge
  - 周期性上报状态到后端
  - 本地审计日志缓存（环形缓冲区 + 远程同步）

### 8.2 M2: Security Authorization Controller（独立安全授权控制器）

**模块定位**：Appliance 的最终授权决策引擎，独立于网关 Linux 运行，承担所有密码学校验、策略匹配、物理确认和 interlock 控制。即使网关 Linux 被攻破，控制器仍能独立执行 fail-closed。

首选：

```text
NUCLEO-H563ZI（STM32H563ZI, Arm Cortex-M33, 250 MHz）
```

备选：

```text
NUCLEO-U575ZI-Q（STM32U575ZI, Arm Cortex-M33, 160 MHz, 超低功耗）
NXP LPC55S69-EVK（Arm Cortex-M33, 150 MHz, 硬件安全引擎）
```

硬件参数：

| 参数 | STM32H563 | STM32U575 | NXP LPC55S69 |
| --- | --- | --- | --- |
| 内核 | Cortex-M33 | Cortex-M33 | Cortex-M33 |
| 主频 | 250 MHz | 160 MHz | 150 MHz |
| Flash | 2 MB | 1 MB | 640 KB |
| RAM | 640 KB | 786 KB | 360 KB |
| 安全特性 | TrustZone, HASH, AES, PKA | TrustZone, AES, PKA, PUF | TrustZone, AES, SHA, PUF |
| 接口 | SPI, I2C, UART, USB, GPIO | SPI, I2C, UART, USB, GPIO | SPI, I2C, UART, USB, GPIO |
| HSM 支持 | 内置安全启动 | 内置安全启动 | 内置安全启动 |

职责（12 项核心任务）：

1. 接收 gateway daemon 的 release request（通过 serial JSON 协议）；
2. 校验 challenge（不允许复用）；
3. 校验 policyDigest（必须匹配本地已签名策略）；
4. 校验 monotonic counter（不允许回滚）；
5. 校验 expiry（过期拒绝）；
6. 驱动 Secure Element 执行签名或身份验证；
7. 读取物理确认按钮状态（支持 button timeout）；
8. 控制 interlock output（relay 驱动）；
9. 读取 feedback input（辅助触点反馈）；
10. 周期性发送 heartbeat 到 gateway daemon；
11. 上报完整 state 到后端（通过 gateway daemon 转发）；
12. 支持 emergency stop（紧急停止按钮中断一切操作）。

通信协议：

- **Controller ↔ Gateway Daemon**：Serial JSON over UART / USB-CDC / RS485
  - 消息格式：newline-delimited JSON
  - 消息类型：`release_request`, `release_response`, `heartbeat`, `state_report`, `physical_confirmation_request`, `physical_confirmation_ack`, `emergency_stop`, `alert`
- **Controller ↔ Secure Element**：I2C / SPI（驱动 SE 执行签名、验证、密钥操作）

### 8.3 M3: Secure Element / TPM（安全芯片 / 可信平台模块）

**模块定位**：Appliance 的硬件信任根，保护设备私钥和 grant 签名密钥，确保设备身份不可伪造、授权签名不可抵赖。

#### 8.3.1 Secure Element（必选）

首选：

```text
Infineon OPTIGA Trust M
```

备选：

```text
NXP EdgeLock SE050
Microchip ATECC608B
STSAFE-A110
```

选型对比：

| 特性 | OPTIGA Trust M | SE050 | ATECC608B | STSAFE-A110 |
| --- | --- | --- | --- | --- |
| 算法支持 | ECC-256/384, RSA-2048, AES-128/256 | ECC-256/384/521, RSA, AES, 3DES | ECC-256, AES-128/256 | ECC-256 |
| 密钥存储 | 非导出私钥, 4 KB data | 非导出私钥, 可扩展 | 非导出私钥, 16 slots | 非导出私钥 |
| 接口 | I2C | I2C | I2C / SPI | I2C |
| 认证 | CC EAL6+ (high) | CC EAL6+ | CC EAL5+ | CC EAL5+ |
| 封装 | VQFN-32 | HVQFN-20 | SOIC-8 / UDFN-8 | VFQFPN-20 |
| 温度范围 | -25°C ~ 85°C | -25°C ~ 85°C | -40°C ~ 85°C | -25°C ~ 85°C |

职责：

- 保存设备私钥（非导出，仅在 SE 内部完成签名运算）；
- 生成或验证 grant 签名（ECDSA P-256 over SHA-256）；
- 绑定设备身份（唯一设备标识符 + 公钥证书）；
- 支持 provisioning workflow（密钥注入、证书链建立）；
- 支持后续 mTLS / device certificate 扩展；
- 支持 monotonic counter 硬件实现（如 SE 原生支持）。

签名消息格式（15 字段 newline-joined）：

```text
gateId
sessionId
actionId
tenantId
scope
targetId
commandType
payloadHash
policyDigest
challenge
breakerTarget
interlockAction
issuedAt
expiresAt
monotonicCounter
```

#### 8.3.2 TPM 2.0（可选，位于 Gateway 主板）

```text
板载 TPM 2.0 模块（如 Infineon SLB 9670 / ST33TPHF2X）
```

职责（与 Secure Element 互补）：

- 平台级度量启动（Measured Boot）：记录 BIOS / bootloader / kernel / initrd 的哈希链
- 固件完整性度量：gateway daemon 启动前验证固件 digest
- 平台身份认证：TPM quote + AIK 用于远程 attestation
- 密钥保护：可选将 gateway daemon 的通信密钥存储在 TPM 的 NV RAM 中

### 8.4 M4: Fail-closed Interlock（硬件级闭锁机制）

**模块定位**：Appliance 的物理执行层，通过硬件 relay 和 feedback 闭环实现"默认断开、授权闭合、异常回落"的 fail-closed 原则。

组件清单：

| 组件 | 规格 | 职责 |
| --- | --- | --- |
| DIN-rail relay | 24V DC, SPDT/DPDT, 额定 10A | 物理控制 SERVER ↔ LAN/WAN 通断 |
| 隔离数字输出 | 光耦隔离, 24V 驱动 | 安全控制器驱动 relay |
| 隔离数字输入 | 光耦隔离, 24V 兼容 | 读取 feedback 辅助触点 |
| Feedback 辅助触点 | 与主触点机械联动 | 反馈 relay 真实物理状态 |
| Emergency stop 按钮 | 常闭触点, 红色蘑菇头 | 一键切断所有 release，立即 isolated |
| Confirmation 按钮 | 瞬时触点, 绿色 | 物理确认授权操作 |
| Stack light 塔灯 | 三色（红/黄/绿）+ 蜂鸣器 | 实时指示 Appliance 状态 |

工作原理：

```text
                ┌─────────────────────────────────────┐
                │     Security Controller (M2)         │
                │                                      │
  release ─────►│  interlock_output ──────► relay coil │
  granted       │                         ┌────────────┤
                │                         │ 主触点闭合  │
                │  interlock_input ◄──────│            │
                │  (feedback)    ◄────────│ 辅助触点   │
                │                         └────────────┘
                │                                      │
                │  IF feedback != expected → ISOLATE   │
                │  IF heartbeat lost      → ISOLATE   │
                │  IF emergency_stop      → ISOLATE   │
                └─────────────────────────────────────┘
```

Fail-closed 触发条件（9 类自动隔离触发器）：

1. Secure Element 签名验证失败
2. Monotonic counter 回滚检测
3. policyDigest 与本地已签名策略不匹配
4. Grant 有效期到期（expiresAt）
5. Secure Element 不可用或通信中断
6. Feedback 辅助触点状态与期望不一致
7. Controller heartbeat 丢失（> 45 秒无心跳）
8. MGMT 独立管理通道不健康
9. Gateway daemon 与 Controller 状态冲突

Bridge 状态机：

```text
isolated ──(release granted + feedback OK)──► released
    ▲                                            │
    │                                            │
    └────(window expiry / fault / estop)─────────┘
    
isolated ──(release pending)──► armed ──(confirmed)──► released
    ▲                              │                       │
    │                              │(timeout)              │(window expiry)
    └──────────────────────────────┘                       │
    └──────────────────────────────────────────────────────┘
```

四种 bridge 状态：

| 状态 | 含义 |
| --- | --- |
| `isolated` | 默认断开，SERVER ↔ LAN/WAN 无转发 |
| `armed` | 已验证释放请求，等待物理确认或自动授权 |
| `released` | interlock 已释放，SERVER ↔ LAN/WAN 在 release window 内可转发 |
| `fault` | 检测到硬件异常或 feedback 不一致 |

---

## 9. 系统架构

```text
AetherGuard Backend / Dashboard (控制平面)
        |
        | HTTPS / WebSocket (经 MGMT 独立通道)
        v
┌─────────────────────────────────────────────────┐
│  AetherGuard Root-Resistant Gateway Appliance    │
│                                                  │
│  M1: Multi-port Gateway (工业多网口网关)         │
│  ├── Gateway Daemon (Linux 守护进程)             │
│  ├── nftables bridge/firewall (数据平面控制)     │
│  │                                               │
│  │   SERVER port ◄──► controlled ◄──► LAN/WAN    │
│  │                     bridge                    │
│  │                                               │
│  │   MGMT port ◄──► Backend (管理平面)           │
│  │                                               │
│  ├── Serial JSON ◄──► M2: Security Controller    │
│  │   (UART / USB-CDC / RS485)                    │
│  │                                               │
│  │                  M2: STM32H5/U5                │
│  │                  ├── I2C/SPI ◄──► M3: SE/TPM  │
│  │                  ├── GPIO ◄──► M4: Interlock   │
│  │                  ├── GPIO ◄──► 物理确认按钮    │
│  │                  └── GPIO ◄──► 紧急停止按钮    │
│  │                                               │
│  │                  M3: Secure Element / TPM      │
│  │                  (OPTIGA / SE050 / ATECC608B)  │
│  │                                               │
│  │                  M4: Fail-closed Interlock     │
│  │                  ├── relay (24V DIN-rail)      │
│  │                  ├── feedback (辅助触点)       │
│  │                  └── stack light (状态指示)    │
└─────────────────────────────────────────────────┘
```

关键原则：

> M1 Gateway Linux 可以请求 release，但不能单方面完成最终 release。最终 release 必须经过 M2 Security Controller 状态机、M3 Secure Element 签名验证和 M4 Interlock 物理反馈闭环。

---

## 10. Root-resistant Active 判定条件

UI 只能在满足全部条件时显示：

```text
Root-resistant Active
```

必须满足：

1. external gateway present；
2. SERVER 口 link up；
3. LAN/WAN 口 link up；
4. MGMT 独立通道 healthy；
5. Secure Element provisioned；
6. controller heartbeat healthy；
7. gateway daemon healthy；
8. policyDigest matched；
9. firmware digest / attestation matched，MVP 可标记为 simulated / not enforced；
10. bridge state 为 isolated 或 armed；
11. feedback 与期望状态一致；
12. 最近一次 counter 未回滚。

如果不满足，应显示具体原因：

```text
Root-resistant Degraded:
- Secure Element not provisioned
- Feedback mismatch
- MGMT path unhealthy
- Policy digest mismatch
```

---

## 11. 功能需求

### 11.1 网关注册

#### 描述

外部 Gateway 向 AetherGuard 后端注册自身身份、端口信息、硬件控制器状态和 Secure Element 状态。

#### 验收标准

- Gateway 有唯一 ID；
- 后端可查看 SERVER / LAN/WAN / MGMT 端口状态；
- 后端可查看 controller heartbeat；
- 后端可查看 Secure Element provisioned 状态；
- 注册事件进入 audit log。

### 11.2 默认隔离

#### 描述

Gateway 启动后默认进入 `isolated`。SERVER ↔ LAN/WAN 不允许转发。

#### 验收标准

- 重启后默认 isolated；
- controller heartbeat 丢失时 isolated；
- gateway daemon 重启后 isolated；
- policyDigest 不匹配时 isolated；
- feedback mismatch 时 isolated；
- UI 显示 isolated 原因。

### 11.3 Release 请求

#### 描述

后端可对 Gateway 发起临时 release 请求。

请求必须包含：

- action；
- target；
- policyDigest；
- challenge；
- payloadHash；
- expiresAt；
- requestedBy；
- reason；
- releaseWindow；
- counter。

#### 验收标准

- 缺少任一关键字段拒绝；
- challenge 不能复用；
- expiresAt 过期拒绝；
- counter 回滚拒绝；
- policyDigest 不匹配拒绝；
- 被拒绝原因进入 audit log。

### 11.4 硬件授权

#### 描述

Security Controller 接收 release request 后执行本地验证。验证通过后，可要求物理确认或自动授权，取决于策略。

#### 验收标准

- 支持 physical confirmation required；
- 支持 button timeout；
- 支持 emergency stop；
- 支持 Secure Element 签名；
- 支持 monotonic counter；
- 支持 grantSignature；
- 授权结果可回传后端。

### 11.5 Interlock 控制

#### 描述

Security Controller 控制 interlock output。Gateway daemon 只有在 interlock released 且 feedback 一致时才打开 bridge。

#### 验收标准

- interlock released 前，SERVER ↔ LAN/WAN 不通；
- interlock released 后，在 release window 内允许转发；
- release window 到期后回到 isolated；
- feedback mismatch 时立即 isolated；
- emergency stop 时立即 isolated。

### 11.6 状态上报

#### 描述

Gateway 和 Security Controller 定期上报状态。

状态包括：

- gateway health；
- controller heartbeat；
- bridge state；
- interlock state；
- feedback state；
- port link state；
- policyDigest；
- firmwareDigest；
- secureElementStatus；
- lastGrantCounter；
- lastReleaseResult。

#### 验收标准

- UI 可实时显示；
- 后端可保存历史状态；
- 状态异常触发告警；
- 所有状态变更进入 audit log。

### 11.7 审计日志

#### 描述

所有 release、deny、fault、policy update、heartbeat loss、feedback mismatch 都必须进入 tamper-evident audit log。

#### 验收标准

每条审计至少包含：

- timestamp；
- gatewayId；
- controllerId；
- action；
- target；
- requestedBy；
- challengeHash；
- policyDigest；
- counter；
- result；
- reason；
- signatureStatus；
- feedbackState；
- bridgeState。

---

## 12. 用户故事

### Story 1：安全负责人查看最后防线状态

作为安全负责人，  
我希望看到每台关键服务器是否处于 root-resistant active，  
以便判断当前最后防线是否真实有效。

验收标准：

- 显示 active / degraded / inactive；
- degraded 必须显示原因；
- 支持查看最近一次 release 记录；
- 支持查看硬件 controller 状态。

### Story 2：运维发起高危操作

作为运维人员，  
我希望在执行 host_remove 前由硬件确认授权，  
以避免后台 API 或被攻破主机单方面执行高危操作。

验收标准：

- 请求进入 pending；
- 控制器要求物理确认；
- 按钮确认后 release；
- 超时未确认则拒绝；
- 全过程可审计。

### Story 3：服务器被 root 后仍无法恢复网络

作为安全团队，  
我希望即使服务器 root 被攻击者控制，也不能从服务器内部恢复 LAN/WAN 连接，  
以降低横向移动和破坏扩散风险。

验收标准：

- 在 protected server 上修改本机防火墙无效；
- 在 protected server 上停止 agent 不会打开 gateway；
- 只有 external gateway release 后才可连通；
- release 到期后自动断开。

### Story 4：硬件异常时自动隔离

作为运维负责人，  
我希望硬件状态异常时系统自动隔离，  
以避免错误放行。

验收标准：

- controller heartbeat loss → isolated；
- feedback mismatch → isolated；
- secure element unavailable → reject release；
- policyDigest mismatch → reject release；
- UI 显示 fault reason。

---

## 13. MVP 范围

### 13.1 必须实现

- Gateway daemon；
- Gateway 注册和状态上报；
- SERVER / LAN/WAN / MGMT 三口模型；
- bridge isolated / released 控制；
- STM32 controller 串口协议；
- heartbeat；
- physical confirmation；
- interlock output；
- feedback input；
- Secure Element 基础签名或设备身份；
- 后端 Final Defense 状态 API；
- UI 状态页；
- audit log；
- release window；
- fail-closed。

### 13.2 可以模拟

MVP 阶段允许模拟：

- firmware digest；
- attestation；
- measured boot；
- secure boot enforcement；
- hardware PHY-level cut-off。

但 UI 和文档必须标记：

```text
simulated
not enforced
prototype only
```

不能把模拟能力宣传成已完成能力。

---

## 14. 非功能需求

### 14.1 安全需求

- 默认 isolated；
- deny by default；
- 所有 release 必须有有效期；
- counter 不允许回滚；
- challenge 不允许复用；
- policyDigest 必须匹配；
- feedback mismatch 必须 fail-closed；
- controller heartbeat loss 必须 fail-closed；
- audit log 必须防篡改；
- Secure Element 私钥不可导出。

### 14.2 可用性需求

- Gateway 重启后自动恢复管理连接；
- 网络隔离不影响 MGMT 口；
- 控制器断开后后端显示 degraded；
- release 到期自动回落；
- 状态变化 5 秒内反映到 UI，MVP 可放宽到 10 秒。

### 14.3 性能需求

MVP 阶段目标：

- release 请求处理时间 < 3 秒；
- heartbeat 间隔 1-5 秒；
- 状态上报延迟 < 5 秒；
- Gateway 转发性能以 PoC 为主，不作为第一阶段核心指标。

后续版本目标：

- 千兆线速桥接；
- 高并发日志上报；
- 多 gateway fleet 管理。

---

## 15. UI 需求

新增页面或模块：

```text
Final Defense Gateway
```

显示内容：

1. Gateway 总览；
2. Root-resistant Active 状态；
3. SERVER / LAN/WAN / MGMT 端口状态；
4. bridge state；
5. interlock state；
6. feedback state；
7. controller heartbeat；
8. Secure Element 状态；
9. policyDigest match；
10. last release；
11. fault reason；
12. audit timeline。

状态文案建议：

```text
Root-resistant Active
Root-resistant Degraded
Final Defense Isolated
Release Pending
Release Active
Feedback Mismatch
Hardware Controller Offline
Secure Element Not Provisioned
Policy Digest Mismatch
```

---

## 16. API 需求

可以复用或扩展现有 Final Defense API：

```text
GET  /api/final-defense/status
POST /api/final-defense/policies
POST /api/final-defense/actions
POST /api/final-defense/gateways/status/report
POST /api/final-defense/gateways/actions
```

建议新增或明确：

```text
GET  /api/final-defense/gateways
GET  /api/final-defense/gateways/:gatewayId
POST /api/final-defense/gateways/:gatewayId/release-requests
POST /api/final-defense/gateways/:gatewayId/isolate
POST /api/final-defense/gateways/:gatewayId/policies
GET  /api/final-defense/gateways/:gatewayId/audit
```

---

## 17. 成功指标

### 17.1 技术成功指标

- protected server 无法绕过 external gateway 恢复 LAN/WAN；
- gateway 默认 isolated；
- release 必须经过 controller；
- Secure Element 可完成至少一种签名或设备身份验证；
- feedback mismatch 可触发 fail-closed；
- 所有 release / deny / fault 可审计；
- UI 能准确展示 active / degraded / isolated。

### 17.2 演示成功指标

现场演示可完成：

1. SERVER 默认无法访问 LAN/WAN；
2. Dashboard 显示 isolated；
3. 后端发起 release request；
4. 控制器等待按钮确认；
5. 按钮确认后 release；
6. SERVER 恢复网络；
7. release window 到期自动断开；
8. 拔掉 controller 或制造 feedback mismatch；
9. 系统立即 fail-closed；
10. Dashboard 显示原因和审计记录。

### 17.3 商业验证指标

- 3 个目标客户或评委认可“服务器外部最后防线”价值；
- 2 个潜在客户愿意做 PoC；
- 1 个客户提出真实部署场景；
- 路演中能在 3 分钟内讲清楚 root-resistant 边界；
- 技术评审没有把它误解成普通路由器或普通继电器。

---

## 18. 风险与对策

| 风险 | 说明 | 对策 |
| --- | --- | --- |
| 过度宣传 | “完全最后防线”容易被认为绝对安全 | 明确工程定义和适用条件 |
| 网关 Linux 被攻破 | 如果只靠 nftables，不够 root-resistant | 引入独立 controller 和硬件 interlock |
| Secure Element 集成复杂 | OPTIGA / SE050 学习成本较高 | 第一版可用 ATECC608 快速跑通 |
| 硬件演示不稳定 | 接线、供电、串口可能出问题 | 使用 DIN rail、电源、端子和状态灯增强稳定性 |
| 客户质疑开发板 | Nucleo 是开发板不是最终产品 | 明确这是 PoC，量产会收敛为专用控制板 |
| 认证问题 | 原型未做 EMC/安规 | 宣传为验证平台，不宣称量产认证 |
| 真实网络切断不足 | 软件桥接可能被质疑 | roadmap 中加入 PHY/switch-level interlock |

---

## 19. Roadmap

### Phase 0：硬件采购与台架搭建

周期：1-2 周

交付：

- Protectli / 工业网关；
- STM32H5/U5 控制器；
- Secure Element；
- relay / feedback；
- 24V 电源；
- 按钮和塔灯；
- 初始接线图。

### Phase 1：Final Defense Control Loop

周期：2-4 周

交付：

- controller heartbeat；
- serial JSON protocol；
- button confirmation；
- interlock output；
- feedback input；
- backend status ingest；
- UI 状态显示。

### Phase 2：Gateway Network Isolation

周期：2-4 周

交付：

- SERVER / LAN/WAN / MGMT 三口配置；
- bridge isolated / released；
- release window；
- fail-closed；
- audit log；
- dashboard demo flow。

### Phase 3：Secure Element Integration

周期：2-4 周

交付：

- device identity；
- grant signature；
- counter；
- challenge；
- policyDigest；
- provisioning script。

### Phase 4：Root-resistant Demo

周期：2 周

交付：

- 完整演示脚本；
- 攻击模拟脚本；
- 演示视频；
- 技术白皮书；
- 客户 PoC 材料。

### Phase 5：产品化评估

周期：4-8 周

交付：

- 自研控制板 BOM；
- 量产硬件架构；
- secure boot 方案；
- PHY/switch-level interlock 方案；
- 认证路径；
- 成本评估。

---

## 20. 宣传页核心文案

### 标题

> **AetherGuard Root-Resistant Gateway Appliance**  
> 服务器失陷后的自研硬件最后防线一体机

### 副标题

> 将关键网络释放权移出被保护服务器，通过自研工业级多网口网关一体机、独立安全授权控制器和硬件信任根，实现默认隔离、授权释放、异常回落和全链路审计。

### 三个卖点

#### 1. 服务器被 root 后仍有外部控制边界

> AetherGuard 不假设服务器永远可信。即使攻击者拿到 root，关键网络释放仍由 Appliance 的安全控制器决定。

#### 2. 高危操作必须经过硬件授权

> 后端和主机软件只能请求，最终 grant 由独立 STM32 控制器、Secure Element、策略 digest、counter 和 feedback 校验共同决定。

#### 3. 默认隔离，异常回落

> 签名失败、策略不匹配、counter 回滚、feedback mismatch、控制器离线或 heartbeat 丢失时，Appliance 自动保持或回落到 isolated。

### 一句话演示脚本

> 现在我们假设这台服务器已经被攻击者拿到 root。攻击者可以停掉 Agent、改本机防火墙、删日志，但他仍然不能从这台服务器内部恢复外部网络，因为最终网络释放权不在服务器上，而在 AetherGuard Root-Resistant Gateway Appliance 这台自研硬件最后防线一体机上。

---

## 21. 最终对外统一口径

> **AetherGuard 的核心不是“多做一个安全 Agent”，而是在服务器外部建立一条 root-resistant 的最终控制边界。我们自研的 AetherGuard Root-Resistant Gateway Appliance 集成了工业多网口网关、STM32H5/U5 安全授权控制器、Secure Element / TPM 和硬件级 fail-closed interlock，实现默认隔离、硬件授权、状态反馈和审计闭环。Appliance 全面替代此前的 ESP32 硬件方案，从串口部署 dongle 升级为具备双千兆数据口、独立管理通道和物理级网络隔离能力的一体机。**
