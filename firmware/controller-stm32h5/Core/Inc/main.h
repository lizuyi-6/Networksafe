/**
 * @file main.h
 * @brief Main application header
 *
 * STM32H563ZI controller for AetherGuard Gateway Appliance (M2).
 */

#ifndef MAIN_H
#define MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

#include "stm32h5xx_hal.h"
#include "controller_tasks.h"
#include "serial_json.h"
#include "se_driver.h"
#include "interlock_driver.h"

/* Exported functions */
void Error_Handler(void);

/* Peripheral handles (defined in main.c) */
extern UART_HandleTypeDef huart3;
extern I2C_HandleTypeDef hi2c1;
extern TIM_HandleTypeDef htim6;
extern TIM_HandleTypeDef htim7;

#ifdef __cplusplus
}
#endif

#endif /* MAIN_H */
