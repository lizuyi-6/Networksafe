/**
 * FluxGuard ESP32 - 自动化部署工具配置
 * 
 * 硬件清单:
 * - ESP32-WROOM-32 (Type-C)
 * - OLED 0.96" (I2C)
 * - RGB LED (共阴)
 * - 有源蜂鸣器
 * - 3个轻触按键
 * - USB-TTL (连接目标服务器)
 */

#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// ============================================
// 1. I2C OLED 显示屏 (SSD1306)
// ============================================
#define ENABLE_SCREEN       1
#define SCREEN_WIDTH        128
#define SCREEN_HEIGHT       64
#define SCREEN_ADDRESS      0x3C
#define PIN_I2C_SDA         21
#define PIN_I2C_SCL         22

// ============================================
// 2. 物理按键
// ============================================
#define PIN_BTN_OK          15      // [确认/开始]
#define PIN_BTN_NEXT        4       // [切换/跳过]
#define PIN_BTN_BACK        5       // [取消/返回]

// ============================================
// 3. RGB LED 指示灯
// ============================================
#define PIN_RGB_RED         25
#define PIN_RGB_GREEN       26
#define PIN_RGB_BLUE        27
#define RGB_COMMON_ANODE    0       // 1=共阳, 0=共阴 (根据实际硬件调整)

// ============================================
// 4. 蜂鸣器
// ============================================
#define PIN_BUZZER          14
#define BUZZER_ACTIVE       1       // 1=有源, 0=无源

// ============================================
// 5. 目标服务器通信 (USB-TTL)
// ============================================
#define TARGET_SERIAL       Serial2
#define TARGET_RX_PIN       16      // 连接 CP2102 TX
#define TARGET_TX_PIN       17      // 连接 CP2102 RX
#define TARGET_BAUD         115200

// ============================================
// 部署与安全配置
// ============================================
#define INSTALL_CMD_URL     "curl -sL http://192.168.4.2:8080/install.sh | bash"
#define CHECK_CMD           "fluxguard-agent --version"

// 备份命令 (Linux)
// 创建时间戳目录并根据需要备份关键配置，这里以备份 /etc 为示例
#define BACKUP_CMD          "mkdir -p /tmp/fg_backup_$(date +%s) && tar -czf /tmp/fg_backup_$(date +%s)/etc_backup.tar.gz /etc/fluxguard /etc/hosts 2>/dev/null || echo 'Backup Skipped'"

// 敏感操作关键字 (用于触发人工确认)
// 简单的子串匹配
#define CRITICAL_KEYWORDS   "rm ","remove","uninstall","delete","format"

// 缓冲区
#define RX_BUFFER_SIZE      2048
#define JSON_BUFFER_SIZE    1024

// DEBUG
#define ENABLE_DEBUG        1
#if ENABLE_DEBUG
    #define DEBUG_PRINT(x)      Serial.print(x)
    #define DEBUG_PRINTLN(x)    Serial.println(x)
    #define DEBUG_PRINTF(...)   Serial.printf(__VA_ARGS__)
#else
    #define DEBUG_PRINT(x)      ((void)0)
    #define DEBUG_PRINTLN(x)    ((void)0)
    #define DEBUG_PRINTF(...)   ((void)0)
#endif

#endif // CONFIG_H
