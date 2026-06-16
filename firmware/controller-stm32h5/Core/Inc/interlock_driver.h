/**
 * @file interlock_driver.h
 * @brief M4 Fail-Closed Interlock Driver
 *
 * Controls relay output and reads feedback auxiliary contact.
 */

#ifndef INTERLOCK_DRIVER_H
#define INTERLOCK_DRIVER_H

#include <stdint.h>
#include <stdbool.h>

/* GPIO pins (adjust to match CubeMX pinout) */
#define INTERLOCK_RELAY_PIN     GPIO_PIN_5    // PA5
#define INTERLOCK_RELAY_PORT    GPIOA

#define INTERLOCK_FEEDBACK_PIN  GPIO_PIN_6    // PA6
#define INTERLOCK_FEEDBACK_PORT GPIOA

#define ESTOP_BUTTON_PIN        GPIO_PIN_13   // PC13 (USER_BTN)
#define ESTOP_BUTTON_PORT       GPIOC

#define CONFIRM_BUTTON_PIN      GPIO_PIN_0    // PA0
#define CONFIRM_BUTTON_PORT     GPIOA

/* Stack light */
#define LIGHT_RED_PIN           GPIO_PIN_0    // PB0
#define LIGHT_RED_PORT          GPIOB

#define LIGHT_YELLOW_PIN        GPIO_PIN_7    // PB7
#define LIGHT_YELLOW_PORT       GPIOB

#define LIGHT_GREEN_PIN         GPIO_PIN_14   // PB14
#define LIGHT_GREEN_PORT        GPIOB

#define LIGHT_BUZZER_PIN        GPIO_PIN_1    // PB1
#define LIGHT_BUZZER_PORT       GPIOB

/* Relay control */
void interlock_init(void);
void interlock_drive_relay(bool release);  // true=close relay (release), false=open (assert/isolated)

/* Feedback readback */
bool interlock_read_feedback(void);  // true=relay closed (from auxiliary contact)

/* Buttons */
bool interlock_read_estop(void);     // true=E-stop pressed (normally closed, LOW=pressed)
bool interlock_read_confirm(void);   // true=confirmation button pressed

/* Stack light */
void interlock_set_light(uint8_t red, uint8_t yellow, uint8_t green, uint8_t buzzer);

#endif /* INTERLOCK_DRIVER_H */
