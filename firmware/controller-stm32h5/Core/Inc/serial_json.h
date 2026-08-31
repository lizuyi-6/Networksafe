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
/*
 * N2-2 (audit 2026-08): the policy digest is a 64-char SHA-256 hex string.
 * json_find_string writes at most out_len-1 payload bytes + NUL, so a 64
 * buffer silently truncated the digest to 63 chars — the M1 channel MAC
 * (computed over the full 64-char digest) then NEVER verified, and the
 * digest anchor silently bound only a 63-char prefix. 65 = 64 + NUL.
 */
#define SERIAL_JSON_MAX_DIGEST 65
_Static_assert(SERIAL_JSON_MAX_DIGEST == CONTROLLER_POLICY_DIGEST_LEN,
               "serial_json and controller digest buffers must hold the same 64-char digest");

/* Incoming message types (Gateway → Controller) */
typedef enum {
    MSG_TYPE_COMMAND = 0,
    MSG_TYPE_HELLO,
    MSG_TYPE_TIME_SYNC,
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
    /* FW-004: time_sync frame payload; valid only when time_valid. */
    uint32_t time_epoch_s;
    bool time_valid;
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
