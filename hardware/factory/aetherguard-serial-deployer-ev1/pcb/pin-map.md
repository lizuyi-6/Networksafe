# EV1 Pin Map

Firmware profile: `serial_deployer_pcb_v1`

The PCB variant keeps the jumper prototype GPIO map and changes only the buzzer active level to `HIGH`.

| Function | ESP32 pin | Firmware symbol | Manufacturing note |
| --- | --- | --- | --- |
| OLED SDA | GPIO21 | `PIN_I2C_SDA` | I2C SSD1306 OLED, 0x3C. |
| OLED SCL | GPIO22 | `PIN_I2C_SCL` | I2C SSD1306 OLED, 400 kHz target. |
| OK button | GPIO18 | `PIN_BTN_OK` | Active low with pull-up. |
| NEXT button | GPIO19 | `PIN_BTN_NEXT` | Active low with pull-up. |
| BACK button | GPIO23 | `PIN_BTN_BACK` | Active low with pull-up. |
| RGB red | GPIO25 | `PIN_RGB_RED` | Common-cathode RGB baseline. |
| RGB green | GPIO26 | `PIN_RGB_GREEN` | Common-cathode RGB baseline. |
| RGB blue | GPIO27 | `PIN_RGB_BLUE` | Common-cathode RGB baseline. |
| Buzzer | GPIO14 | `PIN_BUZZER` | PCB profile uses `BUZZER_ACTIVE_LEVEL=HIGH`. |
| Target UART RX | GPIO16 | `TARGET_RX_PIN` | Connected to host CP2102N TXD. |
| Target UART TX | GPIO17 | `TARGET_TX_PIN` | Connected to host CP2102N RXD. |
| Service UART TX | GPIO1 | UART0 TXD | Connected to service CP2102N RXD. |
| Service UART RX | GPIO3 | UART0 RXD | Connected to service CP2102N TXD. |

## Protocol Smoke Test

The target-host serial link must support this minimum factory smoke path:

```text
Gate -> Host: AG:REQ:ENV
Host -> Gate: AG:ENV:LINUX
```

