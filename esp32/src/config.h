/**
 * AetherGuard ESP32 serial deployer configuration.
 *
 * Default baseline:
 * - Jumper prototype on an ESP32 development board
 * - 0.96" I2C OLED
 * - Three buttons wired to GND with INPUT_PULLUP
 * - Common-cathode RGB module
 * - Active-low buzzer module
 * - One external CP2102 used in deployment mode on UART2
 *
 * Optional board profile:
 * - AG_HW_PROFILE_PCB_V1=1 for the single-board KiCad PCB variant
 * - Keeps the same GPIO map, but flips the buzzer control polarity to HIGH
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

#ifndef AG_HW_PROFILE_PCB_V1
#define AG_HW_PROFILE_PCB_V1     0
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
#define BUZZER_ACTIVE           1
#if AG_HW_PROFILE_PCB_V1
#define BUZZER_ACTIVE_LEVEL     HIGH
#else
#define BUZZER_ACTIVE_LEVEL     LOW
#endif

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

// --- Deploy Bundle (SPIFFS cache for offline deployment) ---
#define DEPLOY_BUNDLE_MAX_SIZE    (1024 * 1024)     // 1 MB max bundle
#define RECEIVE_CHUNK_SIZE       1024               // Each chunk during USB write
#define DEPLOY_FILE_NAME_MAX     64                 // Max filename length
#define SPIFFS_MOUNT_POINT       "/deploy"           // SPIFFS mount point
#define SPIFFS_MAX_FILES         10
#define SPIFFS_MAX_FILE_SIZE     (512 * 1024)        // 512 KB per file
#define DEPLOY_WRITE_TIMEOUT_MS  30000               // 30s to receive full bundle
#define DEPLOY_PLAY_TIMEOUT_MS   60000               // 60s to play bundle to target

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

#endif // CONFIG_H
