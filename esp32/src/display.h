/**
 * FluxGuard ESP32 - 显示驱动模块
 * 
 * 适配 SSD1306 I2C OLED (128x64)
 * 使用简易接口定义
 * 
 * UI 状态:
 * - STATUS: 显示 IP, 模式, 连接数
 * - SCANNING: 进度条, "Scanning..."
 * - RESULT: "Threat Detected!", 威胁等级
 * - ACTION: "Block IP?", [OK] Confirm, [Next] Skip
 */

#ifndef DISPLAY_H
#define DISPLAY_H

#include <Arduino.h>
#include <Wire.h>
#include "config.h"

// 简单的字体定义 (5x7) - 省略具体字模数据，使用模拟接口
// 实际固件需链接 Adafruit_SSD1306 或 U8g2

class Display {
private:
    bool enabled;
    
    // I2C 命令辅助
    void sendCmd(uint8_t c) {
        Wire.beginTransmission(SCREEN_ADDRESS);
        Wire.write(0x00);
        Wire.write(c);
        Wire.endTransmission();
    }
    
    void sendData(uint8_t d) {
        Wire.beginTransmission(SCREEN_ADDRESS);
        Wire.write(0x40);
        Wire.write(d);
        Wire.endTransmission();
    }

public:
    void init() {
        #if ENABLE_SCREEN
        Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
        
        // 简易 SSD1306 初始化序列 (仅示意)
        sendCmd(0xAE); // Display OFF
        sendCmd(0xAF); // Display ON
        
        clear();
        drawText(0, 0, "FluxGuard Init...");
        enabled = true;
        DEBUG_PRINTLN("[Display] Init OK");
        #else
        enabled = false;
        #endif
    }
    
    void clear() {
        if (!enabled) return;
        // 清屏逻辑
    }
    
    // 模拟绘制文本
    void drawText(int x, int y, const char* text, int size = 1) {
        if (!enabled) return;
        DEBUG_PRINTF("[Display] (%d,%d) %s\n", x, y, text);
        // 实际调用 U8g2.drawStr(x, y, text);
    }
    
    // UI 页面：待机
    void showStatus(const char* ip, const char* mode) {
        clear();
        drawText(0, 0, "FluxGuard Pro");
        drawText(0, 16, mode);
        drawText(0, 32, ip);
        drawText(0, 48, "Press OK to Scan");
    }
    
    // UI 页面：扫描中
    void showScanning(int progress) {
        clear();
        drawText(0, 0, "Scanning Target...");
        
        // 绘制进度条
        char buf[16];
        sprintf(buf, "[%d%%]", progress);
        drawText(40, 32, buf);
    }
    
    // UI 页面：结果
    void showResult(const char* result, int threatLevel) {
        clear();
        if (threatLevel > 5) {
            drawText(0, 0, "!! THREAT !!", 2);
        } else {
            drawText(0, 0, "Scan Safe");
        }
        
        drawText(0, 24, result);
        
        if (threatLevel > 0) {
            drawText(0, 50, "[OK] Fix  [Next] Skip");
        } else {
            drawText(0, 50, "[OK] Back");
        }
    }
    
    // UI 页面：确认操作
    void showConfirmAction(const char* action) {
        clear();
        drawText(0, 0, "Confirm Action?");
        drawText(0, 20, action);
        drawText(0, 48, "[OK] Yes   [Back] No");
    }
    
    // UI 页面：完成
    void showSuccess(const char* msg) {
        clear();
        drawText(0, 20, "Success!");
        drawText(0, 40, msg);
        delay(1000); 
    }
};

#endif // DISPLAY_H
