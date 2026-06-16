/**
 * @file mock_hal.c
 * @brief Mock STM32 HAL implementation for host testing
 */

#include "stm32h5xx_hal.h"
#include <string.h>
#include <stdio.h>

GPIO_TypeDef gpioa = {0};
GPIO_TypeDef gpiob = {0};
GPIO_TypeDef gpioc = {0};

static uint32_t g_tick = 0;
static bool g_gpio_state[3][16] = {0}; /* [port][pin], port: 0=A,1=B,2=C */
static bool g_estop = false;
static bool g_feedback = false;
static bool g_confirm = false;

static int port_index(GPIO_TypeDef *port) {
    if (port == &gpioa) return 0;
    if (port == &gpiob) return 1;
    if (port == &gpioc) return 2;
    return -1;
}

static int pin_index(uint16_t pin) {
    for (int i = 0; i < 16; i++) {
        if (pin & (1U << i)) return i;
    }
    return -1;
}

GPIO_PinState HAL_GPIO_ReadPin(GPIO_TypeDef *port, uint16_t pin) {
    int p = port_index(port), b = pin_index(pin);
    if (p < 0 || b < 0) return GPIO_PIN_RESET;
    /* Special inputs routed to mock state */
    if (port == &gpioc && pin == GPIO_PIN_13) {
        return g_estop ? GPIO_PIN_RESET : GPIO_PIN_SET; /* NC: LOW=pressed */
    }
    if (port == &gpioa && pin == GPIO_PIN_6) {
        return g_feedback ? GPIO_PIN_SET : GPIO_PIN_RESET;
    }
    if (port == &gpioa && pin == GPIO_PIN_0) {
        return g_confirm ? GPIO_PIN_SET : GPIO_PIN_RESET;
    }
    return g_gpio_state[p][b] ? GPIO_PIN_SET : GPIO_PIN_RESET;
}

void HAL_GPIO_WritePin(GPIO_TypeDef *port, uint16_t pin, GPIO_PinState state) {
    int p = port_index(port), b = pin_index(pin);
    if (p < 0 || b < 0) return;
    g_gpio_state[p][b] = (state == GPIO_PIN_SET);
}

HAL_StatusTypeDef HAL_UART_Transmit(UART_HandleTypeDef *huart, const uint8_t *data, uint16_t len, uint32_t timeout) {
    /* Print serial output to stdout for test visibility */
    (void)huart; (void)timeout;
    fwrite(data, 1, len, stdout);
    return HAL_OK;
}

HAL_StatusTypeDef HAL_I2C_IsDeviceReady(I2C_HandleTypeDef *hi2c, uint16_t addr, uint16_t trials, uint32_t timeout) {
    (void)hi2c; (void)addr; (void)trials; (void)timeout;
    return HAL_OK; /* SE always "present" in mock */
}

HAL_StatusTypeDef HAL_TIM_Base_Start_IT(TIM_HandleTypeDef *htim) {
    (void)htim;
    return HAL_OK;
}

uint32_t HAL_GetTick(void) {
    return g_tick;
}

/* Test accessors */
void mock_set_gpio(GPIO_TypeDef *port, uint16_t pin, bool high) {
    int p = port_index(port), b = pin_index(pin);
    if (p >= 0 && b >= 0) g_gpio_state[p][b] = high;
}

bool mock_get_gpio(GPIO_TypeDef *port, uint16_t pin) {
    int p = port_index(port), b = pin_index(pin);
    if (p < 0 || b < 0) return false;
    return g_gpio_state[p][b];
}

void mock_set_estop(bool pressed) { g_estop = pressed; }
void mock_set_feedback(bool closed) { g_feedback = closed; }
void mock_set_confirm(bool pressed) { g_confirm = pressed; }
void mock_set_tick(uint32_t t) { g_tick = t; }

void mock_reset(void) {
    g_tick = 0;
    memset(g_gpio_state, 0, sizeof(g_gpio_state));
    g_estop = g_feedback = g_confirm = false;
}
