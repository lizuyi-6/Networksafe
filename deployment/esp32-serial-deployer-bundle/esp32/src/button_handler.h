/**
 * AetherGuard ESP32 - 多按键事件处理器
 * 
 * 支持多个独立按键的去抖和单击检测
 */

#ifndef BUTTON_HANDLER_H
#define BUTTON_HANDLER_H

#include <Arduino.h>
#include "config.h"

class SimpleButton {
private:
    uint8_t pin;
    bool lastState;
    bool waitingRelease;
    uint32_t lastDebounceTime;
    const uint32_t DEBOUNCE_DELAY = 50;

public:
    void init(uint8_t p) {
        pin = p;
        pinMode(pin, INPUT_PULLUP);
        lastState = HIGH;
        waitingRelease = false;
        lastDebounceTime = 0;
    }

    bool isPressed() {
        bool reading = digitalRead(pin);
        bool pressed = false;

        if (reading != lastState) {
            lastDebounceTime = millis();
        }

        if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY) {
            // 如果状态稳定为 LOW (按下)
            if (reading == LOW) {
                pressed = true; // 简单的按住检测，实际可能需要上升沿触发
            }
        }
        
        lastState = reading;
        return pressed;
    }
    
    // 检测单击 (释放瞬间触发)
    bool isClicked() {
        const uint32_t now = millis();
        bool reading = digitalRead(pin);

        if (reading != lastState) {
            lastDebounceTime = now;
            lastState = reading;
        }

        if ((now - lastDebounceTime) < DEBOUNCE_DELAY) {
            return false;
        }

        if (reading == LOW && !waitingRelease) {
            waitingRelease = true;
            return false;
        }

        if (reading == HIGH && waitingRelease) {
            waitingRelease = false;
            return true;
        }

        return false;
    }
};

class MultiButtonHandler {
public:
    SimpleButton btnOK;
    SimpleButton btnNext;
    SimpleButton btnBack;

    void init() {
        btnOK.init(PIN_BTN_OK);
        btnNext.init(PIN_BTN_NEXT);
        btnBack.init(PIN_BTN_BACK);
    }

    // 可以在主循环中调用检测
    bool isOkClicked() { return btnOK.isClicked(); }
    bool isNextClicked() { return btnNext.isClicked(); }
    bool isBackClicked() { return btnBack.isClicked(); }
};

#endif // BUTTON_HANDLER_H
