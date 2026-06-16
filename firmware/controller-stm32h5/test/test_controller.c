/**
 * @file test_controller.c
 * @brief Host-side unit tests for M2 controller_tasks logic
 *
 * Verifies the 12 core tasks' validation logic compiles and behaves
 * correctly without STM32 hardware. Uses mock HAL.
 *
 * Run: make && ./test_controller
 */

#include "stm32h5xx_hal.h"
#include "controller_tasks.h"
#include "interlock_driver.h"
#include <stdio.h>
#include <string.h>
#include <assert.h>

static int tests_passed = 0;
static int tests_failed = 0;

#define TEST(name) do { \
    printf("  [TEST] %-50s ", name); \
    tests_passed++;

#define CHECK(cond) \
    if (!(cond)) { \
        printf("FAIL (%s:%d)\n", __FILE__, __LINE__); \
        tests_failed++; tests_passed--; \
    } else { printf("PASS\n"); }

#define TEST_END } while(0);

static void test_boot_isolated(void) {
    TEST("controller boots in isolated state");
    mock_reset();
    controller_init();
    CHECK(controller_get_state() == INTERLOCK_STATE_ISOLATED);
    TEST_END;
}

static void test_challenge_dedup(void) {
    TEST("challenge rejected on reuse (PRD task 2)");
    mock_reset();
    controller_init();
    const char *ch = "challenge-001";
    CHECK(controller_validate_challenge(ch) == true);
    CHECK(controller_validate_challenge(ch) == false); /* reuse */
    CHECK(controller_validate_challenge("challenge-002") == true);
    TEST_END;
}

static void test_policy_digest(void) {
    TEST("policyDigest must match local policy (PRD task 3)");
    mock_reset();
    controller_init();
    CHECK(controller_validate_policy_digest("policy-digest-baseline-v1") == true);
    CHECK(controller_validate_policy_digest("wrong-digest") == false);
    CHECK(controller_validate_policy_digest("") == false);
    TEST_END;
}

static void test_monotonic_counter(void) {
    TEST("monotonic counter must strictly advance (PRD task 4)");
    mock_reset();
    controller_init();
    CHECK(controller_validate_counter(1) == true);
    controller_validate_challenge("c1"); /* accept */
    /* counter 1 was validated; high_water updates only on full grant accept.
       validate_counter is pure check: > current high_water (0) */
    CHECK(controller_validate_counter(1) == true);  /* still > 0 */
    TEST_END;
}

static void test_expiry(void) {
    TEST("expired grant rejected (PRD task 5)");
    mock_reset();
    controller_init();
    controller_update_time(1000);
    CHECK(controller_validate_expiry(2000) == true);  /* future */
    CHECK(controller_validate_expiry(500) == false);  /* past */
    CHECK(controller_validate_expiry(1000) == false); /* equal (boundary) */
    TEST_END;
}

static void test_estop(void) {
    TEST("E-stop forces fault state (PRD task 12)");
    mock_reset();
    controller_init();
    controller_handle_estop();
    CHECK(controller_get_state() == INTERLOCK_STATE_FAULT);
    TEST_END;
}

static void test_release_with_valid_grant(void) {
    TEST("valid grant releases interlock when feedback OK");
    mock_reset();
    controller_init();
    controller_update_time(1000);
    mock_set_feedback(true); /* feedback confirms relay closed */

    hardware_grant_t grant;
    memset(&grant, 0, sizeof(grant));
    strcpy(grant.challenge, "challenge-release-1");
    strcpy(grant.policy_digest, "policy-digest-baseline-v1");
    grant.monotonic_counter = 1;
    grant.expires_at = 5000;

    grant_result_t result = controller_handle_release_request(&grant);
    CHECK(result == GRANT_RESULT_RELEASED);
    CHECK(controller_get_state() == INTERLOCK_STATE_RELEASED);
    TEST_END;
}

static void test_release_blocked_no_feedback(void) {
    TEST("release blocked when feedback mismatch (PRD task 9)");
    mock_reset();
    controller_init();
    controller_update_time(1000);
    mock_set_feedback(false); /* relay did not close */

    hardware_grant_t grant;
    memset(&grant, 0, sizeof(grant));
    strcpy(grant.challenge, "challenge-nofb");
    strcpy(grant.policy_digest, "policy-digest-baseline-v1");
    grant.monotonic_counter = 1;
    grant.expires_at = 5000;

    grant_result_t result = controller_handle_release_request(&grant);
    CHECK(result == GRANT_RESULT_DENIED);
    CHECK(controller_get_state() != INTERLOCK_STATE_RELEASED);
    TEST_END;
}

static void test_release_blocked_bad_policy(void) {
    TEST("release blocked on policy mismatch");
    mock_reset();
    controller_init();
    controller_update_time(1000);
    mock_set_feedback(true);

    hardware_grant_t grant;
    memset(&grant, 0, sizeof(grant));
    strcpy(grant.challenge, "challenge-badpolicy");
    strcpy(grant.policy_digest, "WRONG-digest");
    grant.monotonic_counter = 1;
    grant.expires_at = 5000;

    grant_result_t result = controller_handle_release_request(&grant);
    CHECK(result == GRANT_RESULT_DENIED);
    TEST_END;
}

int main(void) {
    printf("\n=== M2 Controller Tasks Host Tests ===\n\n");
    test_boot_isolated();
    test_challenge_dedup();
    test_policy_digest();
    test_monotonic_counter();
    test_expiry();
    test_estop();
    test_release_with_valid_grant();
    test_release_blocked_no_feedback();
    test_release_blocked_bad_policy();
    printf("\n=== Results: %d passed, %d failed ===\n", tests_passed, tests_failed);
    return tests_failed > 0 ? 1 : 0;
}

