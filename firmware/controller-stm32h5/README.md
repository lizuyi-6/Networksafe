# AetherGuard Gateway Controller Firmware (M2)

STM32H563ZI (Cortex-M33, 250MHz) security authorization controller firmware for the AetherGuard Root-Resistant Gateway Appliance.

## Hardware

**Target Board**: NUCLEO-H563ZI (STMicroelectronics)
- MCU: STM32H563ZI (Arm Cortex-M33, 250 MHz, 2MB Flash, 640KB RAM)
- TrustZone: Yes
- Crypto: AES, SHA, PKA (ECDSA/RSA acceleration)
- Interfaces: UART, USB-CDC, I2C, SPI, GPIO
- Cost: ~$25 USD (Digikey/Mouser)

## Responsibilities (PRD §4.2)

The controller implements 12 core tasks:

1. **Receive release request** from M1 Gateway Daemon (serial JSON)
2. **Validate challenge** (not reusable)
3. **Validate policyDigest** (matches local signed policy)
4. **Validate monotonic counter** (no rollback)
5. **Validate expiry** (grant not expired)
6. **Drive M3 Secure Element** (I2C/SPI commands for signing/verification)
7. **Read physical confirmation button** (GPIO input)
8. **Control interlock output** (GPIO drives M4 relay coil via optocoupler)
9. **Read feedback input** (GPIO reads M4 relay auxiliary contact)
10. **Periodic heartbeat** (every 5s to M1)
11. **Report state** (interlockState, feedbackOk, SE present)
12. **Support emergency stop** (GPIO input, normally-closed)

## Serial Protocol

Newline-delimited JSON over UART (default: USART3, 115200 baud) or USB-CDC.

**Controller → Gateway:**
```json
{"type":"hello","ts":1234567890}
{"type":"heartbeat","secureElementPresent":true,"externalPowerPresent":true,"ts":1234567890}
{"type":"state","interlockState":"isolated","feedbackOk":true,"secureElementPresent":true,"ts":1234567890}
{"type":"interlock_result","interlockState":"released","feedbackOk":true,"ts":1234567890}
{"type":"alert","ts":1234567890}
```

**Gateway → Controller:**
```json
{"type":"command","command":"interlock_release","breakerTarget":"server-lan-bridge","grant":{...},"ts":1234567890}
{"type":"command","command":"interlock_assert","breakerTarget":"server-lan-bridge","ts":1234567890}
```

## GPIO Pinout (NUCLEO-H563ZI)

| Function | Pin | Direction | Notes |
|---|---|---|---|
| UART TX (to Gateway) | PD8 (USART3_TX) | Output | Serial JSON frames |
| UART RX (from Gateway) | PD9 (USART3_RX) | Input | Commands from Gateway |
| I2C SCL (to M3 SE) | PB8 (I2C1_SCL) | Output | OPTIGA Trust M |
| I2C SDA (to M3 SE) | PB9 (I2C1_SDA) | Bidir | OPTIGA Trust M |
| Relay Drive | PA5 | Output | GPIO HIGH → drive optocoupler → relay coil |
| Feedback Input | PA6 | Input | GPIO HIGH = relay closed (from auxiliary contact) |
| E-stop Input | PC13 (USER_BTN) | Input | Normally-closed, LOW = E-stop pressed |
| Confirmation Button | PA0 | Input | Momentary, HIGH = confirmation |
| Stack Light Red | PB0 | Output | Isolated state |
| Stack Light Yellow | PB7 | Output | Armed state |
| Stack Light Green | PB14 | Output | Released state |
| Stack Light Buzzer | PB1 | Output | Fault/alert |

## Project Structure

```
firmware/controller-stm32h5/
├── Core/
│   ├── Inc/                      # Application headers
│   │   ├── main.h
│   │   ├── controller_tasks.h    # 12 core tasks
│   │   ├── serial_json.h         # JSON parser/serializer
│   │   ├── se_driver.h           # M3 SE I2C driver
│   │   └── interlock_driver.h    # M4 relay + feedback
│   └── Src/                      # Application source
│       ├── main.c
│       ├── controller_tasks.c
│       ├── serial_json.c
│       ├── se_driver.c
│       └── interlock_driver.c
├── Drivers/                      # STM32 HAL/CMSIS (generated)
├── Middlewares/                  # Third-party (cJSON, etc.)
├── USB_DEVICE/                   # USB-CDC (optional, generated)
├── Makefile                      # Build system
├── STM32H563ZITX_FLASH.ld       # Linker script
├── controller-stm32h5.ioc       # STM32CubeMX project
└── README.md
```

## Development Workflow

### 1. Install Tools

- **STM32CubeMX**: https://www.st.com/en/development-tools/stm32cubemx.html
- **ARM GCC Toolchain**: `sudo apt install gcc-arm-none-eabi`
- **OpenOCD**: `sudo apt install openocd`
- **STM32CubeProgrammer** (optional, for flashing): https://www.st.com/stm32cubeprog

### 2. Generate Project

```bash
# Open STM32CubeMX
# File → New Project → Board Selector → NUCLEO-H563ZI → Start Project
# Configure peripherals (see Peripheral Configuration below)
# Project Manager → Toolchain/IDE → Makefile
# Generate Code
```

### 3. Build

```bash
cd firmware/controller-stm32h5
make -j$(nproc)
```

Output: `build/controller-stm32h5.elf` / `.bin` / `.hex`

### 4. Flash

```bash
# Via OpenOCD (ST-Link on NUCLEO board)
openocd -f interface/stlink.cfg -f target/stm32h5x.cfg -c "program build/controller-stm32h5.elf verify reset exit"

# Or via STM32CubeProgrammer
STM32_Programmer_CLI -c port=SWD -w build/controller-stm32h5.bin 0x08000000 -v -rst
```

### 5. Debug

```bash
# Terminal 1: Start OpenOCD
openocd -f interface/stlink.cfg -f target/stm32h5x.cfg

# Terminal 2: GDB
arm-none-eabi-gdb build/controller-stm32h5.elf
(gdb) target extended-remote :3333
(gdb) monitor reset halt
(gdb) load
(gdb) continue
```

## Peripheral Configuration (STM32CubeMX)

### System
- **RCC**: HSE crystal (8 MHz), PLL to 250 MHz
- **SYS**: Debug Serial Wire

### Communication
- **USART3**: Async, 115200 baud, 8N1 (PD8/PD9)
- **I2C1**: Fast Mode (400 kHz), 7-bit address (PB8/PB9)
- **USB_OTG_FS** (optional): Device only, CDC class

### GPIO
- See GPIO Pinout table above

### Timers
- **TIM6**: Heartbeat timer (5s periodic, triggers heartbeat TX)
- **TIM7**: Watchdog timer (checks for feedback mismatch)

### Interrupts
- USART3_IRQn: RX complete (JSON frame received)
- EXTI13_IRQn: E-stop button (PC13, falling edge)

## Current Status

- [x] Directory structure created
- [ ] STM32CubeMX .ioc project initialized
- [ ] Peripheral configuration (UART, I2C, GPIO, timers)
- [ ] HAL code generation
- [ ] Makefile build system
- [ ] 12 core tasks implemented (C)
- [ ] Serial JSON parser (cJSON or lightweight custom)
- [ ] M3 SE I2C driver (OPTIGA Trust M commands)
- [ ] M4 interlock driver (GPIO relay + feedback)
- [ ] Integration test (connect to simulator M1)
- [ ] Hardware bring-up (NUCLEO + breadboard relay)

## Next Steps

1. **Initialize CubeMX project**: `controller-stm32h5.ioc` with peripherals configured
2. **Implement serial JSON**: Minimal JSON parser (no malloc) for embedded
3. **Implement 12 core tasks**: State machine in `controller_tasks.c`
4. **Port M2 mock logic**: `simulator/m2-controller/mock-controller.ts` → C
5. **I2C SE driver**: OPTIGA Trust M command set (see Infineon SDK)

## References

- PRD: `docs/root-resistant-gateway-prd.md` §4.2
- Phase 0 status: `docs/hardware-phase0-status.md`
- Simulator (reference logic): `simulator/m2-controller/mock-controller.ts`
- Gateway Daemon: `deployment/gateway/bin/aetherguard-gateway-daemon.ts`
- STM32H563 Datasheet: https://www.st.com/resource/en/datasheet/stm32h563zi.pdf
- NUCLEO-H563ZI User Manual: https://www.st.com/resource/en/user_manual/um3115-stm32h5-nucleo144-board-mb1404-stmicroelectronics.pdf
