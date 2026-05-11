/**
 * AetherGuard ESP32 serial deployer configuration.
 *
 * Active jumper-prototype baseline:
 * - ESP32 development board
 * - 0.96" I2C OLED
 * - Three buttons wired to GND with INPUT_PULLUP
 * - Common-cathode RGB module
 * - Active-low buzzer module
 * - One external CP2102 used in deployment mode on UART2
 */

#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// Feature flags
#ifndef ENABLE_ENCRYPTION
#define ENABLE_ENCRYPTION       0
#endif

#ifndef ENABLE_EXPERIMENTAL_CLOUD
#define ENABLE_EXPERIMENTAL_CLOUD 0
#endif

// 1. I2C OLED (SSD1306)
#define ENABLE_SCREEN           1
#define SCREEN_WIDTH            128
#define SCREEN_HEIGHT           64
#define SCREEN_ADDRESS          0x3C
#define DISPLAY_I2C_CLOCK_HZ    400000
#define PIN_I2C_SDA             21
#define PIN_I2C_SCL             22

// 2. Buttons
// Use non-strap GPIOs so a held button does not disturb boot.
#define PIN_BTN_OK              18
#define PIN_BTN_NEXT            19
#define PIN_BTN_BACK            23

// 3. RGB module
#define PIN_RGB_RED             25
#define PIN_RGB_GREEN           26
#define PIN_RGB_BLUE            27
#define RGB_COMMON_ANODE        0

// 4. Buzzer module
#define PIN_BUZZER              14
#define BUZZER_ACTIVE_LEVEL     LOW   // LOW == 0; GPIO14 low → transistor conducts → buzzer sounds

// 5. Target-host serial link (deployment mode via external CP2102)
#define TARGET_SERIAL           Serial2
#define TARGET_RX_PIN           16
#define TARGET_TX_PIN           17
#define TARGET_BAUD             115200

// Deployment protocol
#define SERIAL_REQ_ENV               "AG:REQ:ENV"
#define SERIAL_REQ_BACKUP            "AG:REQ:BACKUP"
#define SERIAL_REQ_INSTALL           "AG:REQ:INSTALL"
#define SERIAL_REQ_REMOVE            "AG:REQ:REMOVE"

// Operator-facing helper status messages
#define HOST_HELPER_NOT_READY_MSG    "Host helper not ready"
#define HOST_HELPER_TIMEOUT_MSG      "Timeout waiting for host helper"

// Serial protocol markers
#define SERIAL_PROTO_ENV_LINUX       "AG:ENV:LINUX"
#define SERIAL_PROTO_ENV_WINDOWS     "AG:ENV:WINDOWS"
#define SERIAL_PROTO_BEGIN_PREFIX    "AG:BEGIN:"
#define SERIAL_PROTO_STEP_PREFIX     "AG:STEP:"
#define SERIAL_PROTO_OK_PREFIX       "AG:OK:"
#define SERIAL_PROTO_ERR_PREFIX      "AG:ERR:"
#define SERIAL_PROTO_OK_BACKUP       "AG:OK:BACKUP"
#define SERIAL_PROTO_ERR_BACKUP      "AG:ERR:BACKUP"
#define SERIAL_PROTO_OK_INSTALL      "AG:OK:INSTALL"
#define SERIAL_PROTO_ERR_INSTALL     "AG:ERR:INSTALL"
#define SERIAL_PROTO_OK_REMOVE       "AG:OK:REMOVE"
#define SERIAL_PROTO_ERR_REMOVE      "AG:ERR:REMOVE"
#define SERIAL_PROTO_ERR_BUSY        "AG:ERR:BUSY"

// Buffers
#define RX_BUFFER_SIZE           2048
#define SERIAL_LINE_BUFFER_SIZE  128
#define JSON_BUFFER_SIZE         1024
#define TX_BUFFER_SIZE           1024

// Timing
#define ENV_CHECK_TIMEOUT_MS     1500
#define BACKUP_TIMEOUT_MS        15000
#define INSTALL_TIMEOUT_MS       45000
#define REMOVE_TIMEOUT_MS        20000
#define BOOT_SPLASH_MS           900
#define UI_SPINNER_INTERVAL_MS   250
#define LOOP_IDLE_DELAY_MS       1

// WiFi / WebSocket / local control plane defaults
// NOTE: The current v1 target is the USB-TTL serial deployer. Cloud-device
// modules remain experimental and are not part of the active build target.
#define WIFI_SSID                "AetherGuard-Setup"
#define WIFI_PASSWORD            "aetherguard123"
#define LOCAL_HOST               "192.168.4.1"
#define LOCAL_PORT               8080
#define SERVER_HOST              "192.168.4.1"
#define SERVER_PORT              3005
#define SERVER_PATH              "/ws/status"
#define SERVER_USE_SSL           0
#define WIFI_CONNECT_TIMEOUT     15000

// Device identity defaults
#define DEVICE_ID                "ESP32-001"
#define DEVICE_VERSION           "1.0.0"
#define API_KEY                  "demo-device-key"

// Legacy aliases used by collector/transport modules
#define SERIAL_RX_PIN            TARGET_RX_PIN
#define SERIAL_TX_PIN            TARGET_TX_PIN

// Debug output
#ifndef ENABLE_DEBUG
#define ENABLE_DEBUG             1
#endif

#if ENABLE_DEBUG
    #define DEBUG_PRINT(x)       Serial.print(x)
    #define DEBUG_PRINTLN(x)     Serial.println(x)
    #define DEBUG_PRINTF(...)    Serial.printf(__VA_ARGS__)
#else
    #define DEBUG_PRINT(x)       ((void)0)
    #define DEBUG_PRINTLN(x)     ((void)0)
    #define DEBUG_PRINTF(...)    ((void)0)
#endif

// ---------------------------------------------------------------------------
// Compile-time guards — Requirement 14.7
// The build MUST fail if any of the 14 hardware-pin macros is undefined.
// ---------------------------------------------------------------------------
#ifndef PIN_I2C_SDA
#  error "config.h: PIN_I2C_SDA is not defined (expected 21)"
#endif
#ifndef PIN_I2C_SCL
#  error "config.h: PIN_I2C_SCL is not defined (expected 22)"
#endif
#ifndef PIN_BTN_OK
#  error "config.h: PIN_BTN_OK is not defined (expected 18)"
#endif
#ifndef PIN_BTN_NEXT
#  error "config.h: PIN_BTN_NEXT is not defined (expected 19)"
#endif
#ifndef PIN_BTN_BACK
#  error "config.h: PIN_BTN_BACK is not defined (expected 23)"
#endif
#ifndef PIN_RGB_RED
#  error "config.h: PIN_RGB_RED is not defined (expected 25)"
#endif
#ifndef PIN_RGB_GREEN
#  error "config.h: PIN_RGB_GREEN is not defined (expected 26)"
#endif
#ifndef PIN_RGB_BLUE
#  error "config.h: PIN_RGB_BLUE is not defined (expected 27)"
#endif
#ifndef RGB_COMMON_ANODE
#  error "config.h: RGB_COMMON_ANODE is not defined (expected 0)"
#endif
#ifndef PIN_BUZZER
#  error "config.h: PIN_BUZZER is not defined (expected 14)"
#endif
#ifndef BUZZER_ACTIVE_LEVEL
#  error "config.h: BUZZER_ACTIVE_LEVEL is not defined (expected LOW / 0)"
#endif
#ifndef TARGET_RX_PIN
#  error "config.h: TARGET_RX_PIN is not defined (expected 16)"
#endif
#ifndef TARGET_TX_PIN
#  error "config.h: TARGET_TX_PIN is not defined (expected 17)"
#endif
#ifndef TARGET_BAUD
#  error "config.h: TARGET_BAUD is not defined (expected 115200)"
#endif

#endif // CONFIG_H
