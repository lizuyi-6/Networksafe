/**
 * @file serial_json.c
 * @brief Serial JSON parser/serializer (no malloc, fixed buffers)
 *
 * Minimal JSON handling for embedded use. Only parses the fields
 * the controller needs (command + grant fields).
 */

#include "main.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

static char g_tx_buffer[SERIAL_JSON_MAX_LINE];

/* Simple JSON field extraction (finds "key":"value" or "key":number) */
static bool json_find_string(const char *json, const char *key,
                              char *out, uint16_t out_len) {
    char pattern[32];
    snprintf(pattern, sizeof(pattern), "\"%s\":\"", key);
    const char *p = strstr(json, pattern);
    if (!p) return false;
    p += strlen(pattern);
    const char *end = strchr(p, '"');
    if (!end) return false;
    uint16_t len = end - p;
    if (len >= out_len) len = out_len - 1;
    memcpy(out, p, len);
    out[len] = '\0';
    return true;
}

static bool json_find_uint(const char *json, const char *key, uint32_t *out) {
    char pattern[32];
    snprintf(pattern, sizeof(pattern), "\"%s\":", key);
    const char *p = strstr(json, pattern);
    if (!p) return false;
    p += strlen(pattern);
    *out = (uint32_t)strtoul(p, NULL, 10);
    return true;
}

void serial_json_init(void) {
    memset(g_tx_buffer, 0, sizeof(g_tx_buffer));
}

bool serial_json_parse(const char *line, parsed_message_t *out) {
    memset(out, 0, sizeof(*out));
    char type[16];
    if (!json_find_string(line, "type", type, sizeof(type))) {
        out->type = MSG_TYPE_UNKNOWN;
        return false;
    }
    if (strcmp(type, "command") == 0) {
        out->type = MSG_TYPE_COMMAND;
        if (!json_find_string(line, "command", out->command, sizeof(out->command))) {
            return false;
        }
        if (strcmp(out->command, "interlock_release") == 0) {
            json_find_string(line, "challenge", out->grant.challenge, SERIAL_JSON_MAX_CHALLENGE);
            json_find_string(line, "policyDigest", out->grant.policy_digest, SERIAL_JSON_MAX_DIGEST);
            json_find_uint(line, "monotonicCounter", &out->grant.monotonic_counter);
            json_find_uint(line, "expiresAt", &out->grant.expires_at);
        }
        return true;
    }
    if (strcmp(type, "hello") == 0) {
        out->type = MSG_TYPE_HELLO;
        return true;
    }
    out->type = MSG_TYPE_UNKNOWN;
    return false;
}

static void send_frame(const char *json) {
    uint16_t len = (uint16_t)strlen(json);
    serial_json_tx(json, len);
    serial_json_tx("\n", 1);
}

void serial_json_send_hello(void) {
    send_frame("{\"type\":\"hello\"}");
}

void serial_json_send_heartbeat(bool se_present, bool external_power) {
    int n = snprintf(g_tx_buffer, sizeof(g_tx_buffer),
        "{\"type\":\"heartbeat\",\"secureElementPresent\":%s,\"externalPowerPresent\":%s}",
        se_present ? "true" : "false",
        external_power ? "true" : "false");
    (void)n;
    send_frame(g_tx_buffer);
}

void serial_json_send_state(interlock_state_t state, bool feedback_ok, bool se_present) {
    const char *state_str[] = {"isolated","armed","released","fault","disabled","unknown"};
    int n = snprintf(g_tx_buffer, sizeof(g_tx_buffer),
        "{\"type\":\"state\",\"interlockState\":\"%s\",\"feedbackOk\":%s,\"secureElementPresent\":%s}",
        state_str[state],
        feedback_ok ? "true" : "false",
        se_present ? "true" : "false");
    (void)n;
    send_frame(g_tx_buffer);
}

void serial_json_send_interlock_result(interlock_state_t state, bool feedback_ok) {
    const char *state_str[] = {"isolated","armed","released","fault","disabled","unknown"};
    int n = snprintf(g_tx_buffer, sizeof(g_tx_buffer),
        "{\"type\":\"interlock_result\",\"interlockState\":\"%s\",\"feedbackOk\":%s}",
        state_str[state], feedback_ok ? "true" : "false");
    (void)n;
    send_frame(g_tx_buffer);
}

void serial_json_send_alert(void) {
    send_frame("{\"type\":\"alert\"}");
}


