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
#include "grant_auth.h"

extern UART_HandleTypeDef huart3;

static controller_state_t g_state;
static uint32_t g_current_time_s = 0;
/* SECURITY FIX (audit 2026-08, FW-004): g_current_time_s used to be written
 * by nothing but tests (controller_update_time had no production caller),
 * so the expiry check compared against a frozen 0 — every grant with
 * expires_at > 0 passed forever. The controller now tracks whether a time
 * sync has EVER arrived (daemon sends {"type":"time_sync","epochS":...});
 * until then expiry validation fails closed. */
static bool g_time_synced = false;
static uint8_t g_channel_key[GRANT_AUTH_KEY_BYTES];
static bool g_channel_key_provisioned = false;
/* FW-006: optional persistence backend for the high-water mark. */
static const controller_counter_store_t *g_counter_store = NULL;

/* FW-004: tolerate small backwards jitter (re-sync races), reject a large
 * clock rewind — otherwise a UART attacker could replay time_sync frames to
 * revive the expiry window of already-issued grants. The monotonic counter
 * independently blocks grant replay; this guard keeps the two consistent. */
#define TIME_SYNC_MAX_REWIND_S 60u

void controller_init(void) {
    memset(&g_state, 0, sizeof(g_state));
    g_state.state = INTERLOCK_STATE_ISOLATED;
    /* SECURITY FIX (audit 2026-08, FW-010): no compile-time policy-digest
     * placeholder. The local digest is a trust anchor provisioned at
     * manufacturing/pairing (controller_set_policy_digest), exactly like
     * the serial channel key. Until provisioned, every release is denied
     * (empty digest never matches) — fail-closed. */
    g_state.local_policy_digest[0] = '\0';
    g_state.high_water_counter = 0;
    g_state.se_present = true;
    g_state.feedback_ok = false;
    g_state.estop_pressed = false;
    /* Fresh boot: no wall-clock sync yet (FW-004). */
    g_current_time_s = 0;
    g_time_synced = false;
    /* SECURITY FIX (audit 2026-08, FW-001): channel-key provisioning state
     * intentionally survives controller_init() — the key is provisioned once
     * at boot (manufacturing/pairing path in main.c, before the first
     * release request can arrive) and a software re-init must not silently
     * drop the trust anchor. Until provisioning runs, every release request
     * is denied — fail-closed. */
    interlock_drive_relay(false);
    interlock_set_light(1, 0, 0, 0);
}

/* SECURITY FIX (audit 2026-08, FW-001): provision (or rotate) the M1<->M2
 * serial channel MAC key. Called from the manufacturing/pairing path (or
 * host tests). Production key storage ultimately lives in the Secure
 * Element; while the SE driver is a stub, the key is held in RAM and every
 * release requires a valid HMAC-SHA256 over the canonical grant message.
 * With no key provisioned, ALL release requests are denied — fail-closed. */
bool controller_provision_serial_channel_key(const uint8_t key[GRANT_AUTH_KEY_BYTES]) {
    memcpy(g_channel_key, key, GRANT_AUTH_KEY_BYTES);
    g_channel_key_provisioned = true;
    return true;
}

bool controller_channel_key_provisioned(void) {
    return g_channel_key_provisioned;
}

/* FW-006: attach a persistence backend for the high-water mark. The persisted
 * value is loaded immediately (never lowering an in-memory mark that is
 * already higher — e.g. a grant issued before this attach in the same boot).
 * With no store attached the mark stays RAM-only; deployments then rely on
 * the control-plane DB high-water and the serial channel MAC. */
void controller_attach_counter_store(const controller_counter_store_t *store) {
    g_counter_store = store;
    if (store && store->load) {
        uint32_t persisted = 0;
        if (store->load(&persisted) && persisted > g_state.high_water_counter) {
            g_state.high_water_counter = persisted;
        }
    }
}

void controller_set_policy_digest(const char *digest) {
    strncpy(g_state.local_policy_digest, digest, 63);
    g_state.local_policy_digest[63] = '\0';
}

/* Task 1: Handle release request */
grant_result_t controller_handle_release_request(const hardware_grant_t *grant) {
    /* Task 12 latch: a pressed/unacknowledged e-stop blocks release outright.
     * The physical NC e-stop already breaks the relay circuit; this software
     * latch additionally enforces ISO 13850 semantics — releasing the button
     * must not re-enable anything until the fault is explicitly cleared. */
    if (g_state.estop_pressed || g_state.state == INTERLOCK_STATE_FAULT) {
        serial_json_send_alert();
        return GRANT_RESULT_DENIED;
    }
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
    /* Task 6 (enforced): SE present check */
    if (!g_state.se_present) {
        serial_json_send_alert();
        return GRANT_RESULT_DENIED;
    }
    /* SECURITY FIX (audit 2026-08, FW-001): authenticate the M1->M2 serial
     * hop. Previously the controller released the relay on structural
     * checks alone — a UART attacker who knew the compile-time policy
     * digest string could forge a frame and drive the relay. The frame must
     * now carry HMAC-SHA256 (RFC 2104) over the canonical grant message
     * (challenge|policyDigest|monotonicCounter|expiresAt) keyed with the
     * provisioned channel key, compared in constant time. No key
     * provisioned => ALL releases denied (fail-closed). */
    if (!g_channel_key_provisioned) {
        serial_json_send_alert();
        return GRANT_RESULT_DENIED;
    }
    if (grant->signature_len != GRANT_AUTH_MAC_BYTES) {
        serial_json_send_alert();
        return GRANT_RESULT_DENIED;
    }
    {
        char message[GRANT_AUTH_MAX_MESSAGE];
        uint16_t message_len = grant_auth_build_message(message, sizeof(message),
                                                        grant->challenge,
                                                        grant->policy_digest,
                                                        grant->monotonic_counter,
                                                        grant->expires_at);
        if (message_len == 0) {
            serial_json_send_alert();
            return GRANT_RESULT_DENIED;
        }
        uint8_t expected[GRANT_AUTH_MAC_BYTES];
        grant_auth_hmac_sha256(g_channel_key, GRANT_AUTH_KEY_BYTES,
                               (const uint8_t *)message, message_len, expected);
        if (!grant_auth_constant_time_equal(expected, grant->signature, GRANT_AUTH_MAC_BYTES)) {
            serial_json_send_alert();
            return GRANT_RESULT_DENIED;
        }
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
    /* Advance the high-water mark on successful release so the same counter
     * cannot be replayed (c > high_water must hold for the next grant). This
     * closes the replay window that existed when this branch did not advance
     * the counter; this is a safety tightening, not a relaxation. */
    g_state.high_water_counter = grant->monotonic_counter;
    /* FW-006: persist the mark when a backend is attached. A failed save
     * means the replay protection would silently weaken on power loss —
     * revoke the release we just made and re-assert isolation fail-closed
     * (better a lost release window than an unpersistable safety mark). */
    if (g_counter_store && g_counter_store->save
        && !g_counter_store->save(g_state.high_water_counter)) {
        controller_assert_isolated();
        serial_json_send_alert();
        return GRANT_RESULT_DENIED;
    }
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

/* Task 5: validate expiry — fail-closed until a time sync has arrived
 * (FW-004: an unknown clock cannot prove the grant is still valid). */
bool controller_validate_expiry(uint32_t expires_at) {
    if (!g_time_synced) return false;
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

/* Task 12 reset: clear a latched e-stop. Returns to ISOLATED with the relay
 * open; a fresh grant is still required to release. */
void controller_clear_estop(void) {
    g_state.estop_pressed = false;
    g_state.state = INTERLOCK_STATE_ISOLATED;
    interlock_drive_relay(false);
    interlock_set_light(1, 0, 0, 0);
    /* SECURITY FIX (audit 2026-08): report a fresh feedback reading, same as
     * controller_assert_isolated — the state frame must reflect the relay
     * actually open, not the stale closed reading from the prior release. */
    g_state.feedback_ok = interlock_read_feedback();
    serial_json_send_state(g_state.state, g_state.feedback_ok, g_state.se_present);
}

bool controller_estop_latched(void) {
    return g_state.estop_pressed;
}

/* State accessors */
interlock_state_t controller_get_state(void) { return g_state.state; }
void controller_set_state(interlock_state_t state) { g_state.state = state; }
uint32_t controller_get_high_water_counter(void) { return g_state.high_water_counter; }

void controller_send_alert(void) {
    serial_json_send_alert();
}

/* Update current time. Production callers: the M1 time_sync frame
 * ({"type":"time_sync","epochS":N}, see main.c) and, once CubeMX brings up
 * an RTC/tick source, the 1Hz tick. Marks the clock as synced (FW-004) and
 * rejects a large backwards rewind (replay guard). */
void controller_update_time(uint32_t time_s) {
    if (g_time_synced && time_s + TIME_SYNC_MAX_REWIND_S < g_current_time_s) {
        return;
    }
    g_current_time_s = time_s;
    g_time_synced = true;
}

bool controller_time_synced(void) { return g_time_synced; }

/* Assert isolated (force fail-closed) */
void controller_assert_isolated(void) {
    g_state.state = INTERLOCK_STATE_ISOLATED;
    interlock_drive_relay(false);
    interlock_set_light(1, 0, 0, 0);
    /* SECURITY FIX (audit 2026-08): re-read the physical feedback pin AFTER
     * opening the relay. The previous code reported the stale value captured
     * during the last successful release (feedback_ok == true, relay closed),
     * so an isolated report could claim the relay was still closed — the
     * exact welded-contact failure this signal exists to catch. Consumers
     * (rescue control plane) decide on isolation confirmation using this
     * fresh reading. */
    g_state.feedback_ok = interlock_read_feedback();
    serial_json_send_interlock_result(INTERLOCK_STATE_ISOLATED, g_state.feedback_ok);
}

/* Feedback accessor (host tests / telemetry) */
bool controller_get_feedback_ok(void) {
    return g_state.feedback_ok;
}

