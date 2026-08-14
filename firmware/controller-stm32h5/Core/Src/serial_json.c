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

/*
 * JSON field extraction.
 *
 * The original implementation matched the literal substring "key":" with
 * strstr, which (a) rejected RFC 8259 whitespace around the colon
 * ("key" : "val"), (b) truncated values at the first escaped quote (\"), and
 * (c) could match a key name embedded inside another field's string value.
 *
 * find_value() locates a key in object-member position (the preceding
 * non-whitespace char must be '{' or ',') and returns a pointer just past
 * the colon and any surrounding whitespace. json_find_string then reads the
 * value with proper escape handling; json_find_uint reads leading digits.
 *
 * Defense-in-depth: the grant payload is signature-verified upstream, so the
 * producer is trusted. The goal is RFC correctness and robustness against a
 * non-compact emitter, not parsing adversarial JSON.
 */
static bool is_ws(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; }

static const char *find_value(const char *json, const char *key) {
    char needle[32];
    int n = snprintf(needle, sizeof(needle), "\"%s\"", key);
    if (n <= 0 || (size_t)n >= sizeof(needle)) return NULL;

    const char *search = json;
    while ((search = strstr(search, needle)) != NULL) {
        /* Require object-member position: the previous non-whitespace char
         * must be '{' or ',' so a key name appearing inside a string value
         * is not mistaken for a real field. */
        const char *prev = search;
        while (prev > json && is_ws(prev[-1])) prev--;
        const char *p = search + n; /* just after the key's closing quote */
        if (prev > json && (prev[-1] == '{' || prev[-1] == ',')) {
            while (is_ws(*p)) p++;
            if (*p == ':') {
                p++;
                while (is_ws(*p)) p++;
                return p;
            }
        }
        search += n; /* not a member: keep scanning */
    }
    return NULL;
}

static bool json_find_string(const char *json, const char *key,
                              char *out, uint16_t out_len) {
    const char *p = find_value(json, key);
    if (!p || *p != '"') return false;
    p++; /* past opening quote */
    uint16_t len = 0;
    while (*p != '\0' && *p != '"') {
        if (*p == '\\' && p[1] != '\0') {
            /* JSON escape sequences. \uXXXX and unknown escapes collapse to
             * '?' — controller fields are ASCII, so this never triggers on a
             * well-formed grant. */
            char c = p[1];
            char emit = '?';
            switch (c) {
                case '"':  emit = '"';  break;
                case '\\': emit = '\\'; break;
                case '/':  emit = '/';  break;
                case 'b':  emit = '\b'; break;
                case 'f':  emit = '\f'; break;
                case 'n':  emit = '\n'; break;
                case 'r':  emit = '\r'; break;
                case 't':  emit = '\t'; break;
                default: break;
            }
            if (len + 1 < out_len) out[len++] = emit;
            p += 2;
            continue;
        }
        if (len + 1 < out_len) out[len++] = *p;
        p++;
    }
    if (*p != '"') return false; /* unterminated string */
    out[len] = '\0';
    return true;
}

static bool json_find_uint(const char *json, const char *key, uint32_t *out) {
    const char *p = find_value(json, key);
    if (!p) return false;
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
            /* SECURITY FIX (audit 2026-08, FW-001): channel MAC. Parsed as
             * hex; 32 bytes (64 hex chars) expected for HMAC-SHA256. A
             * missing or malformed field leaves signature_len == 0, which
             * controller_handle_release_request rejects fail-closed. */
            char mac_hex[2 * 64 + 1];
            if (json_find_string(line, "signature", mac_hex, sizeof(mac_hex))) {
                uint16_t hex_len = (uint16_t)strlen(mac_hex);
                if (hex_len > 0 && (hex_len & 1u) == 0u && hex_len / 2u <= sizeof(out->grant.signature)) {
                    bool ok = true;
                    for (uint16_t i = 0; i < hex_len; i++) {
                        char c = mac_hex[i];
                        bool hex_digit = (c >= '0' && c <= '9')
                                      || (c >= 'a' && c <= 'f')
                                      || (c >= 'A' && c <= 'F');
                        if (!hex_digit) { ok = false; break; }
                    }
                    if (ok) {
                        for (uint16_t i = 0; i < hex_len / 2u; i++) {
                            char hex3[3] = { mac_hex[i * 2], mac_hex[i * 2 + 1], '\0' };
                            out->grant.signature[i] = (uint8_t)strtoul(hex3, NULL, 16);
                        }
                        out->grant.signature_len = hex_len / 2u;
                    } else {
                        memset(out->grant.signature, 0, sizeof(out->grant.signature));
                        out->grant.signature_len = 0;
                    }
                }
            }
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


