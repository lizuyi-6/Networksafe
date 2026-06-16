/**
 * @file controller_tasks.h
 * @brief M2 Security Authorization Controller - 12 Core Tasks
 *
 * Implements the state machine and validation logic for the AetherGuard
 * Root-Resistant Gateway Appliance controller (PRD §4.2).
 *
 * 12 Core Tasks:
 * 1. Receive release request
 * 2. Validate challenge (not reusable)
 * 3. Validate policyDigest (matches local signed policy)
 * 4. Validate monotonic counter (no rollback)
 * 5. Validate expiry
 * 6. Drive Secure Element (I2C signing/verification)
 * 7. Read physical confirmation button
 * 8. Control interlock output (relay driver)
 * 9. Read feedback input
 * 10. Periodic heartbeat
 * 11. Report state
 * 12. Support emergency stop
 */

#ifndef CONTROLLER_TASKS_H
#define CONTROLLER_TASKS_H

#include <stdint.h>
#include <stdbool.h>

/* Interlock states (PRD §4.4) */
typedef enum {
    INTERLOCK_STATE_ISOLATED = 0,
    INTERLOCK_STATE_ARMED,
    INTERLOCK_STATE_RELEASED,
    INTERLOCK_STATE_FAULT,
    INTERLOCK_STATE_DISABLED,
    INTERLOCK_STATE_UNKNOWN
} interlock_state_t;

/* Grant validation result */
typedef enum {
    GRANT_RESULT_RELEASED = 0,
    GRANT_RESULT_DENIED
} grant_result_t;

/* Hardware grant structure (subset needed for validation) */
typedef struct {
    char challenge[64];
    char policy_digest[64];
    uint32_t monotonic_counter;
    uint32_t expires_at;        // Unix timestamp (seconds)
    uint8_t signature[64];
    uint16_t signature_len;
} hardware_grant_t;

/* Controller state */
typedef struct {
    interlock_state_t state;
    char used_challenges[16][64];  // Ring buffer of recent challenges
    uint8_t challenge_index;
    char local_policy_digest[64];
    uint32_t high_water_counter;
    bool se_present;
    bool feedback_ok;
    bool estop_pressed;
} controller_state_t;

/* Initialization */
void controller_init(void);
void controller_set_policy_digest(const char *digest);

/* Task 1: Receive and handle release request */
grant_result_t controller_handle_release_request(const hardware_grant_t *grant);

/* Task 2: Validate challenge (not reusable) */
bool controller_validate_challenge(const char *challenge);

/* Task 3: Validate policyDigest */
bool controller_validate_policy_digest(const char *digest);

/* Task 4: Validate monotonic counter */
bool controller_validate_counter(uint32_t counter);

/* Task 5: Validate expiry */
bool controller_validate_expiry(uint32_t expires_at);

/* Task 6: Drive Secure Element (see se_driver.h) */
// Implemented in se_driver.c

/* Task 7: Read physical confirmation button */
bool controller_read_confirmation_button(void);

/* Task 8: Control interlock output */
void controller_drive_interlock(bool release);  // true=release, false=assert

/* Task 9: Read feedback input */
bool controller_read_feedback(void);

/* Task 10: Periodic heartbeat (called from TIM6 ISR) */
void controller_send_heartbeat(void);

/* Task 11: Report state */
void controller_send_state_report(void);

/* Task 12: Emergency stop */
void controller_handle_estop(void);

/* State accessors */
interlock_state_t controller_get_state(void);
void controller_set_state(interlock_state_t state);

/* Alert */
void controller_send_alert(void);

/* Update current time (called from RTC/1Hz tick) */
void controller_update_time(uint32_t time_s);

/* Assert isolated (force fail-closed) */
void controller_assert_isolated(void);

#endif /* CONTROLLER_TASKS_H */
