/**
 * AetherGuard ESP32 - OLED 显示驱动
 *
 * 使用 Adafruit_GFX + Adafruit_SSD1306 驱动真实 128x64 OLED，
 * UI 由主状态机按需刷新，避免在主循环中持续全屏重绘。
 */

#ifndef DISPLAY_H
#define DISPLAY_H

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "config.h"

class Display {
private:
    bool enabled;
    Adafruit_SSD1306 oled;

    void trimLine(const char* input, char* output, size_t outputSize, uint8_t size) {
        if (!outputSize) {
            return;
        }

        if (!input) {
            output[0] = '\0';
            return;
        }

        size_t maxChars = SCREEN_WIDTH / (6 * (size ? size : 1));
        if (maxChars == 0) {
            maxChars = outputSize - 1;
        }

        size_t len = strlen(input);
        if (len > outputSize - 1) {
            len = outputSize - 1;
        }
        if (len > maxChars) {
            len = maxChars;
        }

        memcpy(output, input, len);
        output[len] = '\0';
    }

    void beginFrame() {
        if (!enabled) {
            return;
        }

        oled.clearDisplay();
        oled.setTextColor(SSD1306_WHITE);
        oled.setTextWrap(false);
    }

    void commit() {
        if (enabled) {
            oled.display();
        }
    }

    void drawWrappedText(int x, int y, const char* text, uint8_t size, uint8_t maxLines) {
        if (!enabled || !text || maxLines == 0) {
            return;
        }

        const size_t maxChars = SCREEN_WIDTH / (6 * (size ? size : 1));
        const int lineHeight = 8 * size + 2;
        const char* cursor = text;

        for (uint8_t line = 0; line < maxLines && *cursor; ++line) {
            while (*cursor == ' ') {
                cursor++;
            }

            size_t remaining = strlen(cursor);
            size_t take = remaining > maxChars ? maxChars : remaining;

            if (remaining > maxChars) {
                for (size_t idx = take; idx > maxChars / 2; --idx) {
                    if (cursor[idx] == ' ') {
                        take = idx;
                        break;
                    }
                }
            }

            char buffer[32];
            size_t copyLen = min(take, sizeof(buffer) - 1);
            memcpy(buffer, cursor, copyLen);
            buffer[copyLen] = '\0';

            while (copyLen > 0 && buffer[copyLen - 1] == ' ') {
                buffer[--copyLen] = '\0';
            }

            drawText(x, y + line * lineHeight, buffer, size);
            cursor += take;
        }
    }

public:
    Display() : enabled(false), oled(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1) {}

    void init() {
        #if ENABLE_SCREEN
        Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
        Wire.setClock(DISPLAY_I2C_CLOCK_HZ);

        if (!oled.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
            enabled = false;
            DEBUG_PRINTLN("[Display] SSD1306 init failed");
            return;
        }

        enabled = true;
        oled.cp437(true);
        oled.clearDisplay();
        oled.display();
        showLines("AetherGuard", "OLED Ready", "Serial Deployer", nullptr, false);
        DEBUG_PRINTLN("[Display] Init OK");
        #else
        enabled = false;
        #endif
    }

    bool isEnabled() const {
        return enabled;
    }

    void clear() {
        if (!enabled) {
            return;
        }

        oled.clearDisplay();
        oled.display();
    }

    void drawText(int x, int y, const char* text, int size = 1) {
        if (!enabled || !text) {
            return;
        }

        char buffer[32];
        trimLine(text, buffer, sizeof(buffer), size);
        oled.setTextSize(size);
        oled.setCursor(x, y);
        oled.print(buffer);
    }

    void drawCenteredText(int y, const char* text, int size = 1) {
        if (!enabled || !text) {
            return;
        }

        char buffer[32];
        trimLine(text, buffer, sizeof(buffer), size);
        oled.setTextSize(size);

        int16_t x1;
        int16_t y1;
        uint16_t w;
        uint16_t h;
        oled.getTextBounds(buffer, 0, 0, &x1, &y1, &w, &h);

        int cursorX = (SCREEN_WIDTH - static_cast<int>(w)) / 2;
        if (cursorX < 0) {
            cursorX = 0;
        }

        oled.setCursor(cursorX, y);
        oled.print(buffer);
    }

    void drawProgressBar(int x, int y, int width, int height, int progress) {
        if (!enabled) {
            return;
        }

        int clamped = constrain(progress, 0, 100);
        oled.drawRect(x, y, width, height, SSD1306_WHITE);
        int fillWidth = (width - 2) * clamped / 100;
        oled.fillRect(x + 1, y + 1, fillWidth, height - 2, SSD1306_WHITE);
    }

    void showLines(const char* title, const char* line1, const char* line2, const char* footer, bool emphaticTitle = false) {
        beginFrame();
        if (!enabled) {
            return;
        }

        if (title) {
            drawCenteredText(0, title, emphaticTitle ? 2 : 1);
        }
        if (line1) {
            drawWrappedText(0, emphaticTitle ? 22 : 18, line1, 1, 2);
        }
        if (line2) {
            drawWrappedText(0, 40, line2, 1, 2);
        }
        if (footer) {
            drawCenteredText(56, footer, 1);
        }

        commit();
    }

    void showMenu(const char* envInfo, bool installSelected) {
        beginFrame();
        if (!enabled) {
            return;
        }

        drawCenteredText(0, "Select Action");
        drawText(0, 16, envInfo ? envInfo : "Host Unknown");
        drawText(0, 30, installSelected ? "> Install" : "  Install");
        drawText(0, 42, installSelected ? "  Remove" : "> Remove");
        drawCenteredText(56, "Next=Toggle OK=Run");
        commit();
    }

    void showProgress(const char* title, const char* detail, int progress) {
        beginFrame();
        if (!enabled) {
            return;
        }

        drawCenteredText(0, title ? title : "Working");
        drawProgressBar(10, 18, 108, 12, progress);

        char percent[12];
        snprintf(percent, sizeof(percent), "%d%%", constrain(progress, 0, 100));
        drawCenteredText(34, percent);
        drawWrappedText(0, 46, detail ? detail : "", 1, 2);
        commit();
    }

    void showPrompt(const char* title, const char* detail, const char* footer) {
        showLines(title, detail, nullptr, footer, false);
    }

    void showSuccess(const char* msg) {
        showLines("Success", msg, nullptr, "[OK]/[Back] Reset", false);
    }

    void showError(const char* title, const char* detail, const char* footer) {
        showLines(title, detail, nullptr, footer ? footer : "[Back] Retry", false);
    }
};

#endif // DISPLAY_H
