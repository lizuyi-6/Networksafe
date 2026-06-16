/**
 * @file interlock_driver.c
 * @brief M4 relay + feedback + buttons driver
 */

#include "main.h"

void interlock_init(void) {
    /* GPIO already initialized in main.c via MX_GPIO_Init */
}

void interlock_drive_relay(bool release) {
    /* E-stop takes precedence (fail-closed) */
    if (interlock_read_estop()) {
        HAL_GPIO_WritePin(INTERLOCK_RELAY_PORT, INTERLOCK_RELAY_PIN, GPIO_PIN_RESET);
        return;
    }
    /* release=true → relay closed (HIGH); assert=false → relay open (LOW) */
    HAL_GPIO_WritePin(INTERLOCK_RELAY_PORT, INTERLOCK_RELAY_PIN,
                      release ? GPIO_PIN_SET : GPIO_PIN_RESET);
}

bool interlock_read_feedback(void) {
    /* GPIO HIGH = relay closed (feedback auxiliary contact) */
    return HAL_GPIO_ReadPin(INTERLOCK_FEEDBACK_PORT, INTERLOCK_FEEDBACK_PIN) == GPIO_PIN_SET;
}

bool interlock_read_estop(void) {
    /* Normally-closed button: LOW = pressed (E-stop active) */
    return HAL_GPIO_ReadPin(ESTOP_BUTTON_PORT, ESTOP_BUTTON_PIN) == GPIO_PIN_RESET;
}

bool interlock_read_confirm(void) {
    /* Momentary button: HIGH = pressed */
    return HAL_GPIO_ReadPin(CONFIRM_BUTTON_PORT, CONFIRM_BUTTON_PIN) == GPIO_PIN_SET;
}

void interlock_set_light(uint8_t red, uint8_t yellow, uint8_t green, uint8_t buzzer) {
    HAL_GPIO_WritePin(LIGHT_RED_PORT, LIGHT_RED_PIN, red ? GPIO_PIN_SET : GPIO_PIN_RESET);
    HAL_GPIO_WritePin(LIGHT_YELLOW_PORT, LIGHT_YELLOW_PIN, yellow ? GPIO_PIN_SET : GPIO_PIN_RESET);
    HAL_GPIO_WritePin(LIGHT_GREEN_PORT, LIGHT_GREEN_PIN, green ? GPIO_PIN_SET : GPIO_PIN_RESET);
    HAL_GPIO_WritePin(LIGHT_BUZZER_PORT, LIGHT_BUZZER_PIN, buzzer ? GPIO_PIN_SET : GPIO_PIN_RESET);
}
