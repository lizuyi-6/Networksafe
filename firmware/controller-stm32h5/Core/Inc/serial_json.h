/**
 * @file serial_json.h
 * @brief Serial JSON communication with M1 Gateway Daemon
 *
 * Newline-delimited JSON parser and serializer for embedded use.
 * No malloc, fixed buffers.
 */

#ifndef SERIAL_JSON_H
#define SERIAL_JSON_H

#include <stdint.h>
#include <stdbool.h>
#include "controller_tasks.h"

#define SERIAL_JSON_MAX_LINE 512
#define SERIAL_JSON_MAX_CHALLENGE 64
#define SERIAL_JSON_MAX_DIGEST 64

/* Incoming message types (Gateway → Controller) */
typedef enum {
    MSG_TYPE_COMMAND = 0,
    MSG_TYPE_HELLO,
    MSG_TYPE_UNKNOWN
} msg_type_t;

/* Outgoing frame types (Controller → Gateway) */
typedef enum {
    FRAME_TYPE_HELLO = 0,
    FRAME_TYPE_HEARTBEAT,
    FRAME_TYPE_STATE,
    FRAME_TYPE_INTERLOCK_RESULT,
    FRAME_TYPE_ALERT
} frame_type_t;

/* Parsed command */
typedef struct {
    msg_type_t type;
    char command[32];              // "interlock_release" or "interlock_assert"
    hardware_grant_t grant;        // Present if command=interlock_release
} parsed_message_t;

/* Initialize serial JSON */
void serial_json_init(void);

/* Parse incoming line (called from UART RX complete) */
bool serial_json_parse(const char *line, parsed_message_t *out);

/* Send frame (Controller → Gateway) */
void serial_json_send_hello(void);
void serial_json_send_heartbeat(bool se_present, bool external_power);
void serial_json_send_state(interlock_state_t state, bool feedback_ok, bool se_present);
void serial_json_send_interlock_result(interlock_state_t state, bool feedback_ok);
void serial_json_send_alert(void);

/* Low-level TX (implemented in main.c using HAL_UART_Transmit) */
extern void serial_json_tx(const char *data, uint16_t len);

#endif /* SERIAL_JSON_H */
