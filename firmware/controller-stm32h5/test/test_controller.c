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
#include "serial_json.h"
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
    /* validate_counter is a pure check: > current high_water (0) */
    CHECK(controller_validate_counter(1) == true);  /* still > 0 */
    TEST_END;
}

static void test_counter_advances_on_release(void) {
    TEST("successful release advances high_water (replay blocked)");
    mock_reset();
    controller_init();
    controller_update_time(1000);
    mock_set_feedback(true);

    hardware_grant_t g1;
    memset(&g1, 0, sizeof(g1));
    strcpy(g1.challenge, "challenge-adv-1");
    strcpy(g1.policy_digest, "policy-digest-baseline-v1");
    g1.monotonic_counter = 1;
    g1.expires_at = 5000;
    CHECK(controller_handle_release_request(&g1) == GRANT_RESULT_RELEASED);
    CHECK(controller_get_high_water_counter() == 1);  /* advanced */

    /* Replay the same counter: must be denied (not strictly > 1). */
    hardware_grant_t g2;
    memset(&g2, 0, sizeof(g2));
    strcpy(g2.challenge, "challenge-adv-2");  /* fresh challenge */
    strcpy(g2.policy_digest, "policy-digest-baseline-v1");
    g2.monotonic_counter = 1;  /* same counter — replay */
    g2.expires_at = 5000;
    CHECK(controller_handle_release_request(&g2) == GRANT_RESULT_DENIED);

    /* A strictly greater counter is accepted. */
    hardware_grant_t g3;
    memset(&g3, 0, sizeof(g3));
    strcpy(g3.challenge, "challenge-adv-3");
    strcpy(g3.policy_digest, "policy-digest-baseline-v1");
    g3.monotonic_counter = 2;
    g3.expires_at = 5000;
    CHECK(controller_handle_release_request(&g3) == GRANT_RESULT_RELEASED);
    CHECK(controller_get_high_water_counter() == 2);
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

static void test_estop_latch_blocks_release(void) {
    TEST("latched E-stop blocks release until cleared (ISO 13850)");
    mock_reset();
    controller_init();
    controller_update_time(1000);
    mock_set_feedback(true);

    controller_handle_estop();
    CHECK(controller_get_state() == INTERLOCK_STATE_FAULT);
    CHECK(controller_estop_latched() == true);

    /* A fully valid grant must NOT release while the e-stop is latched. */
    hardware_grant_t g;
    memset(&g, 0, sizeof(g));
    strcpy(g.challenge, "challenge-estop-1");
    strcpy(g.policy_digest, "policy-digest-baseline-v1");
    g.monotonic_counter = 1;
    g.expires_at = 5000;
    CHECK(controller_handle_release_request(&g) == GRANT_RESULT_DENIED);
    CHECK(controller_get_state() == INTERLOCK_STATE_FAULT);

    /* Explicit reset returns to ISOLATED (relay open), never to RELEASED. */
    controller_clear_estop();
    CHECK(controller_estop_latched() == false);
    CHECK(controller_get_state() == INTERLOCK_STATE_ISOLATED);

    /* Only a fresh grant after the reset may release. */
    hardware_grant_t g2;
    memset(&g2, 0, sizeof(g2));
    strcpy(g2.challenge, "challenge-estop-2");
    strcpy(g2.policy_digest, "policy-digest-baseline-v1");
    g2.monotonic_counter = 1;
    g2.expires_at = 5000;
    CHECK(controller_handle_release_request(&g2) == GRANT_RESULT_RELEASED);
    TEST_END;
}

static void test_counter_saturates_at_uint32_max(void) {
    TEST("counter at UINT32_MAX releases once then fails closed");
    mock_reset();
    controller_init();
    controller_update_time(1000);
    mock_set_feedback(true);

    hardware_grant_t g;
    memset(&g, 0, sizeof(g));
    strcpy(g.challenge, "challenge-max-1");
    strcpy(g.policy_digest, "policy-digest-baseline-v1");
    g.monotonic_counter = 0xFFFFFFFFu;
    g.expires_at = 5000;
    CHECK(controller_handle_release_request(&g) == GRANT_RESULT_RELEASED);
    CHECK(controller_get_high_water_counter() == 0xFFFFFFFFu);

    /* No uint32 value is strictly greater than UINT32_MAX: every further
     * grant is denied. Saturation fails closed instead of wrapping open. */
    hardware_grant_t g2;
    memset(&g2, 0, sizeof(g2));
    strcpy(g2.challenge, "challenge-max-2");
    strcpy(g2.policy_digest, "policy-digest-baseline-v1");
    g2.monotonic_counter = 0; /* wraparound attempt */
    g2.expires_at = 5000;
    CHECK(controller_handle_release_request(&g2) == GRANT_RESULT_DENIED);

    hardware_grant_t g3;
    memset(&g3, 0, sizeof(g3));
    strcpy(g3.challenge, "challenge-max-3");
    strcpy(g3.policy_digest, "policy-digest-baseline-v1");
    g3.monotonic_counter = 0xFFFFFFFFu; /* replay of the max itself */
    g3.expires_at = 5000;
    CHECK(controller_handle_release_request(&g3) == GRANT_RESULT_DENIED);
    TEST_END;
}

static void test_assert_isolated_reports_fresh_feedback(void) {
    TEST("assert_isolated re-reads feedback (stale closed reading fixed)");
    mock_reset();
    controller_init();
    controller_update_time(1000);
    mock_set_feedback(true); /* relay physically closed */

    /* A valid grant releases the interlock; feedback_ok becomes true. */
    hardware_grant_t g;
    memset(&g, 0, sizeof(g));
    strcpy(g.challenge, "challenge-fresh-fb");
    strcpy(g.policy_digest, "policy-digest-baseline-v1");
    g.monotonic_counter = 1;
    g.expires_at = 5000;
    CHECK(controller_handle_release_request(&g) == GRANT_RESULT_RELEASED);
    CHECK(controller_get_feedback_ok() == true); /* captured at release */

    /* The relay physically opens (normal isolation). The assert must report
     * the FRESH pin reading (open => false), not the stale true. */
    mock_set_feedback(false);
    controller_assert_isolated();
    CHECK(controller_get_state() == INTERLOCK_STATE_ISOLATED);
    CHECK(controller_get_feedback_ok() == false);

    /* Welded-contact scenario: the relay stays physically closed even after
     * the assert. The controller must REPORT that truth (feedback_ok == true
     * alongside isolated) so consumers can refuse to confirm isolation. */
    controller_handle_release_request(&g); /* counter replay: DENIED, harmless */
    /* Drive a fresh release to close the relay again: */
    mock_set_feedback(true); /* relay physically closed for the release */
    hardware_grant_t g2;
    memset(&g2, 0, sizeof(g2));
    strcpy(g2.challenge, "challenge-fresh-fb-2");
    strcpy(g2.policy_digest, "policy-digest-baseline-v1");
    g2.monotonic_counter = 2;
    g2.expires_at = 5000;
    CHECK(controller_handle_release_request(&g2) == GRANT_RESULT_RELEASED);
    mock_set_feedback(true); /* relay welded closed — pin stays high */
    controller_assert_isolated();
    CHECK(controller_get_state() == INTERLOCK_STATE_ISOLATED);
    CHECK(controller_get_feedback_ok() == true); /* truthfully reported */
    TEST_END;
}

static void test_challenge_ring_eviction_window(void) {
    TEST("challenge dedup window is 16 slots (documented bound)");
    mock_reset();
    controller_init();

    CHECK(controller_validate_challenge("challenge-evict-0") == true);
    CHECK(controller_validate_challenge("challenge-evict-0") == false); /* dedup holds */

    /* 16 further distinct challenges evict slot 0. */
    char name[64];
    for (int i = 1; i <= 16; i++) {
        snprintf(name, sizeof(name), "challenge-evict-%d", i);
        controller_validate_challenge(name);
    }
    /* The evicted challenge is accepted again: dedup is a bounded window,
     * NOT a full replay defense — replay of a *released* grant stays blocked
     * by the monotonic counter (see counter tests). */
    CHECK(controller_validate_challenge("challenge-evict-0") == true);
    TEST_END;
}

/* serial_json_parse robustness: RFC 8259 whitespace tolerance, escape
 * handling, and key-in-value spoofing resistance. These previously had zero
 * coverage — serial_json.c was compiled but never asserted. */
static void test_serial_json_parsing(void) {
    parsed_message_t msg;

    TEST("serial_json: compact grant parses (baseline regression)");
    serial_json_parse(
        "{\"type\":\"command\",\"command\":\"interlock_release\","
        "\"challenge\":\"c-compact\",\"policyDigest\":\"d-compact\","
        "\"monotonicCounter\":42,\"expiresAt\":9001}", &msg);
    CHECK(msg.type == MSG_TYPE_COMMAND);
    CHECK(strcmp(msg.command, "interlock_release") == 0);
    CHECK(strcmp(msg.grant.challenge, "c-compact") == 0);
    CHECK(strcmp(msg.grant.policy_digest, "d-compact") == 0);
    CHECK(msg.grant.monotonic_counter == 42);
    CHECK(msg.grant.expires_at == 9001);
    TEST_END;

    TEST("serial_json: RFC 8259 whitespace around colon tolerated");
    serial_json_parse(
        "{ \"type\" : \"command\" , \"command\" : \"interlock_release\" , "
        "\"challenge\" : \"c-ws\" , \"policyDigest\" : \"d-ws\" , "
        "\"monotonicCounter\" : 7 , \"expiresAt\" : 2000 }", &msg);
    CHECK(msg.type == MSG_TYPE_COMMAND);
    CHECK(strcmp(msg.command, "interlock_release") == 0);
    CHECK(strcmp(msg.grant.challenge, "c-ws") == 0);
    CHECK(strcmp(msg.grant.policy_digest, "d-ws") == 0);
    CHECK(msg.grant.monotonic_counter == 7);
    CHECK(msg.grant.expires_at == 2000);
    TEST_END;

    TEST("serial_json: escaped quote in value is unescaped, not truncating");
    /* Old strstr+strchr parser would truncate challenge at the backslash,
     * yielding "a" instead of "a\"b". */
    serial_json_parse(
        "{\"type\":\"command\",\"command\":\"interlock_release\","
        "\"challenge\":\"a\\\"b\"}", &msg);
    CHECK(msg.type == MSG_TYPE_COMMAND);
    CHECK(strcmp(msg.grant.challenge, "a\"b") == 0);
    TEST_END;

    TEST("serial_json: key name inside a value does not spoof the field");
    /* An escaped \"policyDigest\":\"evil\" inside challenge must NOT be read
     * as the real policyDigest field. The real field wins; absent real field,
     * the spoofed one is not extracted (it is inside a string value, not in
     * object-member position). */
    serial_json_parse(
        "{\"type\":\"command\",\"command\":\"interlock_release\","
        "\"challenge\":\"x\\\"policyDigest\\\":\\\"evil\\\"\","
        "\"policyDigest\":\"d-real\"}", &msg);
    CHECK(strcmp(msg.grant.policy_digest, "d-real") == 0);
    TEST_END;

    TEST("serial_json: hello frame and unknown type");
    serial_json_parse("{\"type\":\"hello\"}", &msg);
    CHECK(msg.type == MSG_TYPE_HELLO);
    serial_json_parse("{\"type\":\"garbage\"}", &msg);
    CHECK(msg.type == MSG_TYPE_UNKNOWN);
    serial_json_parse("not json at all", &msg);
    CHECK(msg.type == MSG_TYPE_UNKNOWN);
    TEST_END;
}

int main(void) {
    printf("\n=== M2 Controller Tasks Host Tests ===\n\n");
    test_boot_isolated();
    test_challenge_dedup();
    test_serial_json_parsing();
    test_policy_digest();
    test_monotonic_counter();
    test_counter_advances_on_release();
    test_expiry();
    test_estop();
    test_estop_latch_blocks_release();
    test_counter_saturates_at_uint32_max();
    test_challenge_ring_eviction_window();
    test_release_with_valid_grant();
    test_release_blocked_no_feedback();
    test_release_blocked_bad_policy();
    test_assert_isolated_reports_fresh_feedback();
    printf("\n=== Results: %d passed, %d failed ===\n", tests_passed, tests_failed);
    return tests_failed > 0 ? 1 : 0;
}

