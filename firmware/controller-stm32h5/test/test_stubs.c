/**
 * @file test_stubs.c
 * @brief Stubs for firmware symbols referenced but not needed in tests
 *
 * Firmware references huart3/hi2c1/htim6/htim7 (defined in main.c),
 * serial_json_tx, HAL_UART_RxCpltCallback etc. Test only exercises
 * controller_tasks logic, so provide minimal stubs.
 */

#include "stm32h5xx_hal.h"
#include <stdint.h>
#include <stdio.h>

UART_HandleTypeDef huart3 = {1};
I2C_HandleTypeDef hi2c1 = {1};
TIM_HandleTypeDef htim6 = {1};
TIM_HandleTypeDef htim7 = {1};

void serial_json_tx(const char *data, uint16_t len) {
    fwrite(data, 1, len, stdout);
}
