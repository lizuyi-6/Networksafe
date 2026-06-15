# Hardware Phase 0 Status — Gateway Appliance

> Status as of 2026-06-15
> 
> Reference: `docs/root-resistant-gateway-prd.md` §12 (Roadmap Phase 0–5)

## Phase 0: 硬件采购与台架搭建

**目标**: M1-M4 到齐,三平面接线完成

---

## M1: Multi-port Gateway (工业多网口网关)

### 采购状态
- [ ] **Protectli Vault VP2430 / VP2420 / VP4650** 或备选(OnLogic/Moxa/Advantech)
- [ ] 确认规格:≥3 个 GbE RJ45(SERVER/LAN-WAN/MGMT),≥4GB RAM,≥32GB 存储
- [ ] 可选:4G/5G M.2 蜂窝模块(MGMT 冗余通道)

### 软件状态
✅ **Gateway Daemon 参考实现已完成** (`backend/src/companion/gateway-daemon.ts`, 238 行)
- ✅ 默认 isolated,fail-closed 全部 9 类触发器
- ✅ grant 签名验证(SE public key)
- ✅ monotonic counter / expiry / feedback 校验
- ✅ controller heartbeat watchdog(45s)
- ✅ release window TTL(30s 自动回落)
- ✅ 测试覆盖:9 passed / 0 failed (`gateway-daemon.test.ts`)

### 待实施
- [ ] 移植 `gateway-daemon.ts` 到嵌入式 Linux(Debian/OpenWrt)
- [ ] 实现 nftables/iptables 桥接规则(`isolated_ruleset` / `released_ruleset`)
- [ ] serial JSON 通信:Gateway ↔ Controller(UART/USB-CDC)
- [ ] 周期性状态上报:`POST /api/final-defense/gateways/status/report`
- [ ] 本地审计日志环形缓冲 + 远程同步

---

## M2: Security Authorization Controller (独立安全授权控制器)

### 采购状态
- [ ] **NUCLEO-H563ZI** (STM32H563ZI, Cortex-M33, 250MHz) 或备选(NUCLEO-U575ZI-Q / NXP LPC55S69-EVK)
- [ ] USB-C 线缆(controller ↔ gateway daemon 通信)

### 固件状态
❓ **Controller 固件未见**(无独立 `firmware/` 或 `controller/` 目录)
- ❓ STM32 CubeMX 项目未初始化
- ❓ 12 项核心任务(PRD §4.2)未实现:
  - release request 接收
  - challenge / policyDigest / counter / expiry 校验
  - SE 驱动(I2C/SPI 签名/验证)
  - 物理确认按钮读取
  - interlock output 驱动(relay)
  - feedback input 读取
  - heartbeat / state 上报
  - emergency stop

### serial JSON 协议
✅ **协议已定义**(PRD §4.2):newline-delimited JSON,消息类型:
- Controller → Gateway: `state`, `heartbeat`, `alert`, `physical_confirmation_ack`, `interlock_result`
- Gateway → Controller: `hello`, `command physical_confirmation_required`, `command interlock_assert`, `command interlock_release`

### 待实施
- [ ] 初始化 STM32 CubeMX 项目(NUCLEO-H563ZI)
- [ ] 实现 12 项核心控制器任务
- [ ] UART/USB-CDC serial JSON 收发
- [ ] I2C/SPI 驱动 Secure Element
- [ ] GPIO 驱动 relay + 读 feedback + 读按钮
- [ ] TrustZone 安全启动(可选,MVP 可延后)

---

## M3: Secure Element / TPM (安全芯片)

### 采购状态
- [ ] **Infineon OPTIGA Trust M** (首选,ECC-256/384, RSA-2048, CC EAL6+) 或备选(SE050/ATECC608B/STSAFE-A110)
- [ ] I2C 接线:SE → NUCLEO 板(SCL/SDA/GND/VCC)
- [ ] 可选:面包板 / grove 转接板

### 软件状态
✅ **grant 签名协议已定义**(`backend/src/security/hardware-grant.ts`):
- 15 字段 newline-joined 消息(`gateId`/`policyDigest`/`challenge`/`monotonicCounter`/...)
- ECDSA P-256 over SHA-256
- 签名验证已在 `gateway-daemon.ts` 实现

### 待实施
- [ ] SE provisioning workflow(生成/注入设备私钥)
- [ ] 绑定设备 ID 到 SE 私钥(不可导出)
- [ ] ECDSA 签名/验证命令(I2C/SPI,从 controller 调用)
- [ ] monotonic counter 硬件实现(可选,MVP 可用软件计数器)

---

## M4: Fail-closed Interlock (硬件级闭锁)

### 采购状态
- [ ] **DIN-rail relay** (24V DC, SPDT/DPDT, 额定 10A)
- [ ] 光耦隔离数字输出(24V 驱动 relay,从 NUCLEO GPIO)
- [ ] 光耦隔离数字输入(24V 兼容,读 feedback 辅助触点)
- [ ] Emergency stop 按钮(常闭触点,红色蘑菇头)
- [ ] Confirmation 按钮(瞬时触点,绿色)
- [ ] Stack light 塔灯(三色红/黄/绿 + 蜂鸣器)
- [ ] 24V DC 电源(供 relay + 塔灯)
- [ ] DIN-rail 安装底座

### 待实施
- [ ] 接线:NUCLEO GPIO → 光耦隔离 → relay 线圈
- [ ] 接线:relay 辅助触点 → 光耦隔离 → NUCLEO GPIO(feedback input)
- [ ] 接线:E-stop 按钮 → relay 或 NUCLEO
- [ ] 接线:confirmation 按钮 → NUCLEO GPIO
- [ ] 接线:塔灯 → NUCLEO GPIO(isolated/armed/released/fault 指示)
- [ ] 验证 feedback 闭环(relay 闭合时 feedback input 必须 HIGH)

---

## 三平面接线(PRD §5)

```
Protected Server NIC → [RJ45 SERVER] M1 Gateway [RJ45 LAN/WAN] → LAN / WAN
                                     [RJ45 MGMT]  → Backend Control Plane
M1 Gateway [USB/UART] → M2 Controller [I2C] → M3 Secure Element
M2 Controller [GPIO] → M4 Relay (physical bridge control)
M2 Controller [GPIO] ← M4 Feedback (readback)
M2 Controller [GPIO] ← E-stop / Confirmation buttons
M2 Controller [GPIO] → Stack light
```

### 待实施
- [ ] 三平面物理接线图(KiCad/Fritzing 或手绘扫描)
- [ ] 验证 SERVER 口 link up
- [ ] 验证 LAN/WAN 口 link up
- [ ] 验证 MGMT 口 link up + 能 ping 到 backend
- [ ] 验证 Gateway ↔ Controller serial JSON 双向通信
- [ ] 验证 Controller ↔ SE I2C 签名/验证命令
- [ ] 端到端验证:`POST /api/final-defense/gateways/actions` → relay 动作 + feedback 确认

---

## Phase 0 完成标准

**必须全部满足**:
- [x] M1 Gateway Daemon 代码完成且测试通过 ✅
- [ ] M1 硬件到货(Protectli 或备选)
- [ ] M2 硬件到货(NUCLEO-H563ZI)
- [ ] M2 固件初始化(CubeMX 项目 + 12 项核心任务骨架)
- [ ] M3 硬件到货(OPTIGA Trust M)
- [ ] M4 硬件到货(relay + 光耦 + 按钮 + 塔灯 + 电源)
- [ ] 三平面物理接线完成
- [ ] 端到端 hello 验证:Gateway daemon 能收到 Controller 的 `hello` / `heartbeat`

---

## 采购清单(BOM)

| 模块 | 物料 | 数量 | 预算(USD) | 采购链接 | 状态 |
|---|---|---|---|---|---|
| M1 | Protectli Vault VP2430 | 1 | ~$400 | protectli.com | ❓ |
| M2 | NUCLEO-H563ZI | 1 | ~$25 | digikey/mouser | ❓ |
| M3 | OPTIGA Trust M(SLS 32AIA010ML) | 1 | ~$3 | digikey/mouser | ❓ |
| M4 | Phoenix Contact PLT-RSC-24DC relay | 1 | ~$15 | digikey | ❓ |
| M4 | 光耦隔离模块(4ch input+output) | 1 | ~$10 | Amazon | ❓ |
| M4 | E-stop 按钮(红色蘑菇头) | 1 | ~$10 | Amazon | ❓ |
| M4 | 确认按钮(绿色瞬时) | 1 | ~$5 | Amazon | ❓ |
| M4 | 塔灯(三色+蜂鸣器) | 1 | ~$30 | Amazon | ❓ |
| M4 | 24V DC 电源(≥2A) | 1 | ~$15 | Amazon | ❓ |
| M4 | DIN-rail 底座 | 1 | ~$10 | Amazon | ❓ |
| — | RJ45 网线(≥3 根) | 1 set | ~$10 | Amazon | ❓ |
| — | USB-C 线缆(NUCLEO) | 1 | ~$5 | Amazon | ❓ |
| — | 杜邦线 / grove 线(GPIO 接线) | 1 set | ~$10 | Amazon | ❓ |
| **Total** | | | **~$548** | | |

---

## 推进建议

### 立即可做(不依赖硬件到货)
1. **初始化 STM32 固件项目**:
   - 创建 `firmware/controller-stm32h5/` 目录
   - 初始化 STM32 CubeMX 项目(NUCLEO-H563ZI)
   - 实现 serial JSON 收发骨架(UART/USB-CDC)
   - 实现 12 项核心任务的空函数骨架
   - 单元测试(host 上模拟,不需要板子)

2. **完善 Gateway Daemon 嵌入式移植计划**:
   - 编写 nftables ruleset 模板(`isolated_ruleset.nft` / `released_ruleset.nft`)
   - 编写 systemd service unit(`aetherguard-gateway-daemon.service`)
   - 打包脚本(Debian .deb / OpenWrt .ipk)

3. **绘制三平面接线图**:
   - KiCad 或 Fritzing 原理图
   - 标注每个接口:RJ45 pinout、GPIO 分配、I2C 地址

### 硬件到货后
4. **M1+M2+M3 bring-up**:
   - Gateway Linux 启动 + SSH 登录
   - NUCLEO 烧录 blink 测试固件
   - I2C scan 找到 OPTIGA Trust M

5. **端到端控制环验证**:
   - Gateway daemon 能收到 Controller heartbeat
   - Backend 能下发 grant,Controller 验签通过
   - Relay 动作,feedback 确认,塔灯指示状态
