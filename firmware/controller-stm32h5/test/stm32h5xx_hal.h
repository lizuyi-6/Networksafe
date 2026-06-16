/**
 * @file stm32h5xx_hal.h
 * @brief Mock STM32 HAL for host-side unit testing
 *
 * Provides minimal type definitions and stub functions so the firmware
 * application code (controller_tasks.c, serial_json.c, interlock_driver.c)
 * can compile and run on the host with gcc, without the real STM32 HAL.
 *
 * This file is ONLY used in test builds (see test/Makefile).
 * On real hardware, STM32CubeMX generates the real stm32h5xx_hal.h.
 */

#ifndef STM32H5XX_HAL_H
#define STM32H5XX_HAL_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Stub handle types (real HAL has full structs; we only need addresses) */
typedef struct { uint32_t instance; } UART_HandleTypeDef;
typedef struct { uint32_t instance; } I2C_HandleTypeDef;
typedef struct { uint32_t instance; } TIM_HandleTypeDef;

/* GPIO */
typedef struct { uint32_t dummy; } GPIO_TypeDef;
typedef enum {
    GPIO_PIN_RESET = 0,
    GPIO_PIN_SET = 1
} GPIO_PinState;
#define GPIO_PIN_0   (1U << 0)
#define GPIO_PIN_1   (1U << 1)
#define GPIO_PIN_5   (1U << 5)
#define GPIO_PIN_6   (1U << 6)
#define GPIO_PIN_7   (1U << 7)
#define GPIO_PIN_13  (1U << 13)
#define GPIO_PIN_14  (1U << 14)

/* HAL status */
typedef enum { HAL_OK = 0, HAL_ERROR, HAL_BUSY, HAL_TIMEOUT } HAL_StatusTypeDef;

/* Mock GPIO ports (defined in mock_hal.c) */
extern GPIO_TypeDef gpioa, gpiob, gpioc;

/* Aliases matching STM32 HAL convention (uppercase) */
#define GPIOA (&gpioa)
#define GPIOB (&gpiob)
#define GPIOC (&gpioc)

/* HAL functions (implemented in mock_hal.c) */
GPIO_PinState HAL_GPIO_ReadPin(GPIO_TypeDef *port, uint16_t pin);
void HAL_GPIO_WritePin(GPIO_TypeDef *port, uint16_t pin, GPIO_PinState state);
HAL_StatusTypeDef HAL_UART_Transmit(UART_HandleTypeDef *huart, const uint8_t *data, uint16_t len, uint32_t timeout);
HAL_StatusTypeDef HAL_I2C_IsDeviceReady(I2C_HandleTypeDef *hi2c, uint16_t addr, uint16_t trials, uint32_t timeout);
HAL_StatusTypeDef HAL_TIM_Base_Start_IT(TIM_HandleTypeDef *htim);
uint32_t HAL_GetTick(void);

/* Test-only accessors for mock state */
void mock_set_gpio(GPIO_TypeDef *port, uint16_t pin, bool high);
bool mock_get_gpio(GPIO_TypeDef *port, uint16_t pin);
void mock_set_estop(bool pressed);
void mock_set_feedback(bool closed);
void mock_set_confirm(bool pressed);
void mock_set_tick(uint32_t t);
void mock_reset(void);

#ifdef __cplusplus
}
#endif

#endif /* STM32H5XX_HAL_H */
