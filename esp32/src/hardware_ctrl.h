/**
 * AetherGuard ESP32 non-blocking hardware control.
 *
 * Responsibilities:
 * - RGB state feedback
 * - Short buzzer notification sequences
 */

#ifndef HARDWARE_CTRL_H
#define HARDWARE_CTRL_H

#include <Arduino.h>
#include "config.h"

enum LEDColor {
    COLOR_OFF = 0,
    COLOR_RED,
    COLOR_GREEN,
    COLOR_BLUE,
    COLOR_YELLOW,
    COLOR_WHITE,
    COLOR_PURPLE
};

class HardwareCtrl {
private:
    LEDColor activeColor;
    LEDColor blinkPrimary;
    LEDColor blinkSecondary;
    bool blinkEnabled;
    bool blinkPrimaryVisible;
    uint32_t blinkIntervalMs;
    uint32_t blinkLastToggleAt;

    bool buzzerSequenceActive;
    bool buzzerEnabled;
    uint8_t buzzerBeepsRemaining;
    uint16_t buzzerToneDurationMs;
    uint16_t buzzerGapDurationMs;
    uint32_t buzzerNextTransitionAt;

    void setPin(uint8_t pin, bool on) {
        #if RGB_COMMON_ANODE
            digitalWrite(pin, on ? LOW : HIGH);
        #else
            digitalWrite(pin, on ? HIGH : LOW);
        #endif
    }

    void applyColor(LEDColor color) {
        setPin(PIN_RGB_RED, false);
        setPin(PIN_RGB_GREEN, false);
        setPin(PIN_RGB_BLUE, false);

        switch (color) {
            case COLOR_RED:
                setPin(PIN_RGB_RED, true);
                break;
            case COLOR_GREEN:
                setPin(PIN_RGB_GREEN, true);
                break;
            case COLOR_BLUE:
                setPin(PIN_RGB_BLUE, true);
                break;
            case COLOR_YELLOW:
                setPin(PIN_RGB_RED, true);
                setPin(PIN_RGB_GREEN, true);
                break;
            case COLOR_WHITE:
                setPin(PIN_RGB_RED, true);
                setPin(PIN_RGB_GREEN, true);
                setPin(PIN_RGB_BLUE, true);
                break;
            case COLOR_PURPLE:
                setPin(PIN_RGB_RED, true);
                setPin(PIN_RGB_BLUE, true);
                break;
            case COLOR_OFF:
            default:
                break;
        }

        activeColor = color;
    }

    void setBuzzer(bool enabled) {
        #if BUZZER_ACTIVE
            const uint8_t inactiveLevel = (BUZZER_ACTIVE_LEVEL == HIGH) ? LOW : HIGH;
            digitalWrite(PIN_BUZZER, enabled ? BUZZER_ACTIVE_LEVEL : inactiveLevel);
        #else
            if (enabled) {
                tone(PIN_BUZZER, 2000);
            } else {
                noTone(PIN_BUZZER);
            }
        #endif
        buzzerEnabled = enabled;
    }

    void startNextBeep() {
        if (!buzzerBeepsRemaining) {
            buzzerSequenceActive = false;
            setBuzzer(false);
            return;
        }

        buzzerBeepsRemaining--;
        setBuzzer(true);
        buzzerNextTransitionAt = millis() + buzzerToneDurationMs;
    }

public:
    HardwareCtrl()
        : activeColor(COLOR_OFF),
          blinkPrimary(COLOR_OFF),
          blinkSecondary(COLOR_OFF),
          blinkEnabled(false),
          blinkPrimaryVisible(true),
          blinkIntervalMs(0),
          blinkLastToggleAt(0),
          buzzerSequenceActive(false),
          buzzerEnabled(false),
          buzzerBeepsRemaining(0),
          buzzerToneDurationMs(0),
          buzzerGapDurationMs(0),
          buzzerNextTransitionAt(0) {}

    void init() {
        pinMode(PIN_RGB_RED, OUTPUT);
        pinMode(PIN_RGB_GREEN, OUTPUT);
        pinMode(PIN_RGB_BLUE, OUTPUT);
        applyColor(COLOR_OFF);

        pinMode(PIN_BUZZER, OUTPUT);
        setBuzzer(false);

        DEBUG_PRINTLN("[Hardware] Init OK");
    }

    void update() {
        const uint32_t now = millis();

        if (blinkEnabled && blinkIntervalMs > 0 && now - blinkLastToggleAt >= blinkIntervalMs) {
            blinkLastToggleAt = now;
            blinkPrimaryVisible = !blinkPrimaryVisible;
            applyColor(blinkPrimaryVisible ? blinkPrimary : blinkSecondary);
        }

        if (!buzzerSequenceActive || now < buzzerNextTransitionAt) {
            return;
        }

        if (buzzerEnabled) {
            setBuzzer(false);
            if (buzzerBeepsRemaining == 0) {
                buzzerSequenceActive = false;
            } else {
                buzzerNextTransitionAt = now + buzzerGapDurationMs;
            }
        } else {
            startNextBeep();
        }
    }

    void setColor(LEDColor color) {
        blinkEnabled = false;
        blinkIntervalMs = 0;
        applyColor(color);
    }

    void setBlink(LEDColor primary, LEDColor secondary, uint32_t intervalMs) {
        blinkPrimary = primary;
        blinkSecondary = secondary;
        blinkIntervalMs = intervalMs;
        blinkEnabled = true;
        blinkPrimaryVisible = true;
        blinkLastToggleAt = millis();
        applyColor(primary);
    }

    void playSequence(uint16_t toneDurationMs, uint8_t count, uint16_t gapDurationMs) {
        buzzerToneDurationMs = toneDurationMs;
        buzzerGapDurationMs = gapDurationMs;
        buzzerBeepsRemaining = count;
        buzzerSequenceActive = count > 0;
        setBuzzer(false);
        if (buzzerSequenceActive) {
            startNextBeep();
        }
    }

    void playSuccess() {
        playSequence(100, 2, 50);
    }

    void playError() {
        playSequence(350, 1, 0);
    }

    void playWarning() {
        playSequence(120, 3, 90);
    }
};

#endif // HARDWARE_CTRL_H
