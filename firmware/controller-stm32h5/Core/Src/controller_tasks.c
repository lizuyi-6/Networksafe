/**
 * @file controller_tasks.c
 * @brief M2 Controller - 12 Core Tasks Implementation
 *
 * State machine and validation logic. Ported from
 * simulator/m2-controller/mock-controller.ts (same logic, C version).
 */

#include "main.h"
#include <string.h>
#include <stdio.h>

extern UART_HandleTypeDef huart3;

static controller_state_t g_state;
static uint32_t g_current_time_s = 0;

void controller_init(void) {
    memset(&g_state, 0, sizeof(g_state));
    g_state.state = INTERLOCK_STATE_ISOLATED;
    strcpy(g_state.local_policy_digest, "policy-digest-baseline-v1");
    g_state.high_water_counter = 0;
    g_state.se_present = true;
    g_state.feedback_ok = false;
    g_state.estop_pressed = false;
    interlock_drive_relay(false);
    interlock_set_light(1, 0, 0, 0);
}

void controller_set_policy_digest(const char *digest) {
    strncpy(g_state.local_policy_digest, digest, 63);
    g_state.local_policy_digest[63] = '\0';
}

/* Task 1: Handle release request */
grant_result_t controller_handle_release_request(const hardware_grant_t *grant) {
    /* Task 2: validate challenge */
    if (!controller_validate_challenge(grant->challenge)) {
        serial_json_send_alert();
        return GRANT_RESULT_DENIED;
    }
    /* Task 3: validate policyDigest */
    if (!controller_validate_policy_digest(grant->policy_digest)) {
        serial_json_send_alert();
        return GRANT_RESULT_DENIED;
    }
    /* Task 4: validate monotonic counter */
    if (!controller_validate_counter(grant->monotonic_counter)) {
        serial_json_send_alert();
        return GRANT_RESULT_DENIED;
    }
    /* Task 5: validate expiry */
    if (!controller_validate_expiry(grant->expires_at)) {
        serial_json_send_alert();
        return GRANT_RESULT_DENIED;
    }
    /* Task 6: SE present check (signature verification is on Gateway Daemon side) */
    if (!g_state.se_present) {
        serial_json_send_alert();
        return GRANT_RESULT_DENIED;
    }
    /* Task 8: drive interlock */
    interlock_drive_relay(true);
    /* Task 9: read feedback */
    g_state.feedback_ok = interlock_read_feedback();
    if (!g_state.feedback_ok) {
        interlock_drive_relay(false);
        serial_json_send_alert();
        return GRANT_RESULT_DENIED;
    }
    g_state.state = INTERLOCK_STATE_RELEASED;
    interlock_set_light(0, 0, 1, 0);
    serial_json_send_interlock_result(INTERLOCK_STATE_RELEASED, true);
    return GRANT_RESULT_RELEASED;
}

/* Task 2: validate challenge (not reusable) */
bool controller_validate_challenge(const char *challenge) {
    if (challenge[0] == '\0') return false;
    for (uint8_t i = 0; i < 16; i++) {
        if (strcmp(g_state.used_challenges[i], challenge) == 0) return false;
    }
    strncpy(g_state.used_challenges[g_state.challenge_index], challenge, 63);
    g_state.used_challenges[g_state.challenge_index][63] = '\0';
    g_state.challenge_index = (g_state.challenge_index + 1) % 16;
    return true;
}

/* Task 3: validate policyDigest */
bool controller_validate_policy_digest(const char *digest) {
    if (digest[0] == '\0') return false;
    return strcmp(digest, g_state.local_policy_digest) == 0;
}

/* Task 4: validate monotonic counter (strictly advance) */
bool controller_validate_counter(uint32_t counter) {
    return counter > g_state.high_water_counter;
}

/* Task 5: validate expiry */
bool controller_validate_expiry(uint32_t expires_at) {
    return expires_at > g_current_time_s;
}

/* Task 7: read confirmation button */
bool controller_read_confirmation_button(void) {
    return interlock_read_confirm();
}

/* Task 8: control interlock output */
void controller_drive_interlock(bool release) {
    interlock_drive_relay(release);
}

/* Task 9: read feedback */
bool controller_read_feedback(void) {
    return interlock_read_feedback();
}

/* Task 10: periodic heartbeat */
void controller_send_heartbeat(void) {
    serial_json_send_heartbeat(g_state.se_present, true);
}

/* Task 11: report state */
void controller_send_state_report(void) {
    serial_json_send_state(g_state.state, g_state.feedback_ok, g_state.se_present);
}

/* Task 12: emergency stop */
void controller_handle_estop(void) {
    g_state.estop_pressed = true;
    g_state.state = INTERLOCK_STATE_FAULT;
    interlock_drive_relay(false);
    interlock_set_light(1, 0, 0, 1);
    serial_json_send_alert();
}

/* State accessors */
interlock_state_t controller_get_state(void) { return g_state.state; }
void controller_set_state(interlock_state_t state) { g_state.state = state; }

void controller_send_alert(void) {
    serial_json_send_alert();
}

/* Update current time (called from RTC/1Hz tick) */
void controller_update_time(uint32_t time_s) { g_current_time_s = time_s; }

/* Assert isolated (force fail-closed) */
void controller_assert_isolated(void) {
    g_state.state = INTERLOCK_STATE_ISOLATED;
    interlock_drive_relay(false);
    interlock_set_light(1, 0, 0, 0);
    serial_json_send_interlock_result(INTERLOCK_STATE_ISOLATED, g_state.feedback_ok);
}


