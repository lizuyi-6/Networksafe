/**
 * FluxGuard ESP32 - 硬件控制模块
 * 
 * 负责控制:
 * - RGB LED (状态指示)
 * - 蜂鸣器 (声音反馈)
 */

#ifndef HARDWARE_CTRL_H
#define HARDWARE_CTRL_H

#include <Arduino.h>
#include "config.h"

// LED 颜色定义
enum LEDColor {
    COLOR_OFF = 0,
    COLOR_RED,      // 错误
    COLOR_GREEN,    // 成功
    COLOR_BLUE,     // 正常/监控
    COLOR_YELLOW,   // 处理中/等待
    COLOR_WHITE,    // 启动/就绪
    COLOR_PURPLE    // 特殊状态
};

class HardwareCtrl {
private:
    void setPin(uint8_t pin, bool on) {
        // 共阳极：LOW亮，HIGH灭
        // 共阴极：HIGH亮，LOW灭
        #if RGB_COMMON_ANODE
            digitalWrite(pin, on ? LOW : HIGH);
        #else
            digitalWrite(pin, on ? HIGH : LOW);
        #endif
    }

public:
    void init() {
        // LED 初始化
        pinMode(PIN_RGB_RED, OUTPUT);
        pinMode(PIN_RGB_GREEN, OUTPUT);
        pinMode(PIN_RGB_BLUE, OUTPUT);
        setColor(COLOR_OFF);
        
        // 蜂鸣器初始化
        pinMode(PIN_BUZZER, OUTPUT);
        digitalWrite(PIN_BUZZER, LOW); // 默认关闭
        
        DEBUG_PRINTLN("[Hardware] Init OK");
    }
    
    // 设置 LED 颜色
    void setColor(LEDColor color) {
        // 先全关
        setPin(PIN_RGB_RED, false);
        setPin(PIN_RGB_GREEN, false);
        setPin(PIN_RGB_BLUE, false);
        
        switch (color) {
            case COLOR_RED:   setPin(PIN_RGB_RED, true); break;
            case COLOR_GREEN: setPin(PIN_RGB_GREEN, true); break;
            case COLOR_BLUE:  setPin(PIN_RGB_BLUE, true); break;
            case COLOR_YELLOW: // 红+绿
                setPin(PIN_RGB_RED, true);
                setPin(PIN_RGB_GREEN, true);
                break;
            case COLOR_WHITE: // 全部
                setPin(PIN_RGB_RED, true);
                setPin(PIN_RGB_GREEN, true);
                setPin(PIN_RGB_BLUE, true);
                break;
            case COLOR_PURPLE: // 红+蓝
                setPin(PIN_RGB_RED, true);
                setPin(PIN_RGB_BLUE, true);
                break;
            case COLOR_OFF:
            default:
                break;
        }
    }
    
    // 鸣叫
    void beep(int durationMs, int count = 1) {
        for (int i = 0; i < count; i++) {
            #if BUZZER_ACTIVE
                digitalWrite(PIN_BUZZER, HIGH);
                delay(durationMs);
                digitalWrite(PIN_BUZZER, LOW);
            #else
                // 无源蜂鸣器需产生 PWM
                tone(PIN_BUZZER, 2000, durationMs);
            #endif
            
            if (i < count - 1) delay(100);
        }
    }
    
    // 成功提示音
    void playSuccess() {
        beep(100);
        delay(50);
        beep(100);
    }
    
    // 错误提示音
    void playError() {
        beep(500); 
    }
};

#endif // HARDWARE_CTRL_H
