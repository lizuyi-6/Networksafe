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
#include "grant_auth.h"
#include <stdio.h>
#include <string.h>
#include <assert.h>

static int tests_passed = 0;
static int tests_failed = 0;

/* Fixed test channel key (host tests only — production provisions at
 * manufacturing/pairing time). 32 bytes as required by grant_auth.h. */
static const uint8_t TEST_CHANNEL_KEY[GRANT_AUTH_KEY_BYTES] = {
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
    0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
    0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
    0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f
};

/* Provision the test key and compute the channel MAC exactly like M1 does
 * (same canonical message construction). Uses the REAL grant_auth code path
 * — an implementation consistent only with itself would prove nothing. */
static void sign_test_grant(hardware_grant_t *g) {
    char message[GRANT_AUTH_MAX_MESSAGE];
    uint16_t len = grant_auth_build_message(message, sizeof(message),
                                            g->challenge, g->policy_digest,
                                            g->monotonic_counter, g->expires_at);
    assert(len > 0);
    grant_auth_hmac_sha256(TEST_CHANNEL_KEY, GRANT_AUTH_KEY_BYTES,
                           (const uint8_t *)message, len, g->signature);
    g->signature_len = GRANT_AUTH_MAC_BYTES;
}

static void provision_test_key(void) {
    controller_provision_serial_channel_key(TEST_CHANNEL_KEY);
}

/* FW-010: the controller boots with NO policy digest (fail-closed) — tests
 * must provision one explicitly, mirroring the manufacturing path. */
#define TEST_POLICY_DIGEST "test-policy-digest-v1"

static void provision_test_policy(void) {
    controller_set_policy_digest(TEST_POLICY_DIGEST);
}

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
    /* FW-010: no compile-time placeholder — an unprovisioned digest denies. */
    CHECK(controller_validate_policy_digest(TEST_POLICY_DIGEST) == false);
    CHECK(controller_validate_policy_digest("") == false);
    provision_test_policy();
    CHECK(controller_validate_policy_digest(TEST_POLICY_DIGEST) == true);
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
    provision_test_key();
    provision_test_policy();
    controller_update_time(1000);
    mock_set_feedback(true);

    hardware_grant_t g1;
    memset(&g1, 0, sizeof(g1));
    strcpy(g1.challenge, "challenge-adv-1");
    strcpy(g1.policy_digest, TEST_POLICY_DIGEST);
    g1.monotonic_counter = 1;
    g1.expires_at = 5000;
    sign_test_grant(&g1);
    CHECK(controller_handle_release_request(&g1) == GRANT_RESULT_RELEASED);
    CHECK(controller_get_high_water_counter() == 1);  /* advanced */

    /* Replay the same counter: must be denied (not strictly > 1). */
    hardware_grant_t g2;
    memset(&g2, 0, sizeof(g2));
    strcpy(g2.challenge, "challenge-adv-2");  /* fresh challenge */
    strcpy(g2.policy_digest, TEST_POLICY_DIGEST);
    g2.monotonic_counter = 1;  /* same counter — replay */
    g2.expires_at = 5000;
    sign_test_grant(&g2);
    CHECK(controller_handle_release_request(&g2) == GRANT_RESULT_DENIED);

    /* A strictly greater counter is accepted. */
    hardware_grant_t g3;
    memset(&g3, 0, sizeof(g3));
    strcpy(g3.challenge, "challenge-adv-3");
    strcpy(g3.policy_digest, TEST_POLICY_DIGEST);
    g3.monotonic_counter = 2;
    g3.expires_at = 5000;
    sign_test_grant(&g3);
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

static void test_expiry_requires_time_sync(void) {
    TEST("FW-004: expiry fails closed when no time sync ever arrived");
    mock_reset();
    controller_init();
    CHECK(controller_time_synced() == false);
    /* Even a far-future expires_at must fail: the clock is unknown. */
    CHECK(controller_validate_expiry(4000000000u) == false);
    controller_update_time(1000);
    CHECK(controller_time_synced() == true);
    CHECK(controller_validate_expiry(2000) == true);
    TEST_END;
}

static void test_time_sync_rewind_rejected(void) {
    TEST("FW-004: large backwards time rewind is rejected (replay guard)");
    mock_reset();
    controller_init();
    controller_update_time(10000);
    CHECK(controller_validate_expiry(10030) == true);
    /* Rewinding more than TIME_SYNC_MAX_REWIND_S must not take effect. */
    controller_update_time(9000);
    CHECK(controller_validate_expiry(10030) == true); /* clock still ~10000 */
    /* Small jitter within tolerance is accepted. */
    controller_update_time(9980);
    CHECK(controller_validate_expiry(10030) == true);
    CHECK(controller_validate_expiry(9975) == false);
    TEST_END;
}

static void test_release_denied_without_time_sync(void) {
    TEST("FW-004: structurally valid grant denied while clock unsynced");
    mock_reset();
    controller_init();
    provision_test_key();
    provision_test_policy();
    /* NOTE: no controller_update_time — expiry must fail closed. */
    mock_set_feedback(true);

    hardware_grant_t grant;
    memset(&grant, 0, sizeof(grant));
    strcpy(grant.challenge, "challenge-nosync");
    strcpy(grant.policy_digest, TEST_POLICY_DIGEST);
    grant.monotonic_counter = 1;
    grant.expires_at = 4000000000u; /* far future — irrelevant */
    sign_test_grant(&grant);

    CHECK(controller_handle_release_request(&grant) == GRANT_RESULT_DENIED);
    CHECK(controller_get_state() == INTERLOCK_STATE_ISOLATED);
    TEST_END;
}

/* ── FW-006: high-water persistence ───────────────────────────────────── */

#include <stdlib.h>

static const char *COUNTER_STORE_PATH(void) {
    static char path[256];
    snprintf(path, sizeof(path), "%s%s", getenv("TEMP") ? getenv("TEMP") : "/tmp",
             "\\ag-fw-counter-store-test.bin");
    return path;
}

static bool file_store_load(uint32_t *out) {
    FILE *f = fopen(COUNTER_STORE_PATH(), "rb");
    if (!f) return false;
    bool ok = fread(out, sizeof(uint32_t), 1, f) == 1;
    fclose(f);
    return ok;
}

static bool file_store_save(uint32_t v) {
    FILE *f = fopen(COUNTER_STORE_PATH(), "wb");
    if (!f) return false;
    bool ok = fwrite(&v, sizeof(uint32_t), 1, f) == 1;
    fclose(f);
    return ok;
}

static bool failing_store_load(uint32_t *out) { (void)out; return false; }
static bool failing_store_save(uint32_t v) { (void)v; return false; }

/* File-scope (NOT stack locals): the attachment is global in the controller
 * and survives across tests — a stack-local struct would dangle after the
 * attaching test returns and crash later release tests through it. */
static controller_counter_store_t g_file_store = { file_store_load, file_store_save };
static controller_counter_store_t g_broken_store = { failing_store_load, failing_store_save };

static void test_counter_store_survives_power_cycle(void) {
    TEST("FW-006: persisted high-water survives a power cycle (replay denied)");
    remove(COUNTER_STORE_PATH());

    /* Boot 1: release at counter 1 (saved to the store). */
    mock_reset();
    controller_init();
    provision_test_key();
    provision_test_policy();
    controller_attach_counter_store(&g_file_store);
    controller_update_time(1000);
    mock_set_feedback(true);
    hardware_grant_t g1;
    memset(&g1, 0, sizeof(g1));
    strcpy(g1.challenge, "challenge-fw006a");
    strcpy(g1.policy_digest, TEST_POLICY_DIGEST);
    g1.monotonic_counter = 1;
    g1.expires_at = 5000;
    sign_test_grant(&g1);
    CHECK(controller_handle_release_request(&g1) == GRANT_RESULT_RELEASED);

    /* Power cycle: fresh init re-attaches the store and restores the mark. */
    mock_reset();
    controller_init();
    provision_test_key();
    provision_test_policy();
    controller_attach_counter_store(&g_file_store);
    controller_update_time(1000);
    mock_set_feedback(true);
    CHECK(controller_get_high_water_counter() == 1);

    /* Replay counter 1 (fresh challenge, valid MAC) must be denied. */
    hardware_grant_t g2;
    memset(&g2, 0, sizeof(g2));
    strcpy(g2.challenge, "challenge-fw006b");
    strcpy(g2.policy_digest, TEST_POLICY_DIGEST);
    g2.monotonic_counter = 1;
    g2.expires_at = 5000;
    sign_test_grant(&g2);
    CHECK(controller_handle_release_request(&g2) == GRANT_RESULT_DENIED);

    /* Strictly greater still works after the restore. */
    hardware_grant_t g3;
    memset(&g3, 0, sizeof(g3));
    strcpy(g3.challenge, "challenge-fw006c");
    strcpy(g3.policy_digest, TEST_POLICY_DIGEST);
    g3.monotonic_counter = 2;
    g3.expires_at = 5000;
    sign_test_grant(&g3);
    CHECK(controller_handle_release_request(&g3) == GRANT_RESULT_RELEASED);

    remove(COUNTER_STORE_PATH());
    /* Detach so later tests exercise the no-store (RAM-only) default. */
    controller_attach_counter_store(NULL);
    TEST_END;
}

static void test_counter_store_save_failure_revokes_release(void) {
    TEST("FW-006: failing store save revokes the release (fail-closed)");
    mock_reset();
    controller_init();
    provision_test_key();
    provision_test_policy();
    
    controller_attach_counter_store(&g_broken_store);
    controller_update_time(1000);
    mock_set_feedback(true);

    hardware_grant_t grant;
    memset(&grant, 0, sizeof(grant));
    strcpy(grant.challenge, "challenge-fw006d");
    strcpy(grant.policy_digest, TEST_POLICY_DIGEST);
    grant.monotonic_counter = 1;
    grant.expires_at = 5000;
    sign_test_grant(&grant);

    CHECK(controller_handle_release_request(&grant) == GRANT_RESULT_DENIED);
    CHECK(controller_get_state() == INTERLOCK_STATE_ISOLATED);
    /* Detach so later tests exercise the no-store (RAM-only) default. */
    controller_attach_counter_store(NULL);
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
    provision_test_key();
    provision_test_policy();
    controller_update_time(1000);
    mock_set_feedback(true); /* feedback confirms relay closed */

    hardware_grant_t grant;
    memset(&grant, 0, sizeof(grant));
    strcpy(grant.challenge, "challenge-release-1");
    strcpy(grant.policy_digest, TEST_POLICY_DIGEST);
    grant.monotonic_counter = 1;
    grant.expires_at = 5000;
    sign_test_grant(&grant);

    grant_result_t result = controller_handle_release_request(&grant);
    CHECK(result == GRANT_RESULT_RELEASED);
    CHECK(controller_get_state() == INTERLOCK_STATE_RELEASED);
    TEST_END;
}

static void test_release_blocked_no_feedback(void) {
    TEST("release blocked when feedback mismatch (PRD task 9)");
    mock_reset();
    controller_init();
    provision_test_key();
    provision_test_policy();
    controller_update_time(1000);
    mock_set_feedback(false); /* relay did not close */

    hardware_grant_t grant;
    memset(&grant, 0, sizeof(grant));
    strcpy(grant.challenge, "challenge-nofb");
    strcpy(grant.policy_digest, TEST_POLICY_DIGEST);
    grant.monotonic_counter = 1;
    grant.expires_at = 5000;
    sign_test_grant(&grant); /* MAC valid — denial must come from feedback */

    grant_result_t result = controller_handle_release_request(&grant);
    CHECK(result == GRANT_RESULT_DENIED);
    CHECK(controller_get_state() != INTERLOCK_STATE_RELEASED);
    TEST_END;
}

static void test_release_blocked_bad_policy(void) {
    TEST("release blocked on policy mismatch");
    mock_reset();
    controller_init();
    provision_test_key();
    provision_test_policy();
    controller_update_time(1000);
    mock_set_feedback(true);

    hardware_grant_t grant;
    memset(&grant, 0, sizeof(grant));
    strcpy(grant.challenge, "challenge-badpolicy");
    strcpy(grant.policy_digest, "WRONG-digest");
    grant.monotonic_counter = 1;
    grant.expires_at = 5000;
    sign_test_grant(&grant);

    grant_result_t result = controller_handle_release_request(&grant);
    CHECK(result == GRANT_RESULT_DENIED);
    TEST_END;
}

static void test_estop_latch_blocks_release(void) {
    TEST("latched E-stop blocks release until cleared (ISO 13850)");
    mock_reset();
    controller_init();
    provision_test_key();
    provision_test_policy();
    controller_update_time(1000);
    mock_set_feedback(true);

    controller_handle_estop();
    CHECK(controller_get_state() == INTERLOCK_STATE_FAULT);
    CHECK(controller_estop_latched() == true);

    /* A fully valid grant must NOT release while the e-stop is latched. */
    hardware_grant_t g;
    memset(&g, 0, sizeof(g));
    strcpy(g.challenge, "challenge-estop-1");
    strcpy(g.policy_digest, TEST_POLICY_DIGEST);
    g.monotonic_counter = 1;
    g.expires_at = 5000;
    sign_test_grant(&g);
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
    strcpy(g2.policy_digest, TEST_POLICY_DIGEST);
    g2.monotonic_counter = 1;
    g2.expires_at = 5000;
    sign_test_grant(&g2);
    CHECK(controller_handle_release_request(&g2) == GRANT_RESULT_RELEASED);
    TEST_END;
}

static void test_counter_saturates_at_uint32_max(void) {
    TEST("counter at UINT32_MAX releases once then fails closed");
    mock_reset();
    controller_init();
    provision_test_key();
    provision_test_policy();
    controller_update_time(1000);
    mock_set_feedback(true);

    hardware_grant_t g;
    memset(&g, 0, sizeof(g));
    strcpy(g.challenge, "challenge-max-1");
    strcpy(g.policy_digest, TEST_POLICY_DIGEST);
    g.monotonic_counter = 0xFFFFFFFFu;
    g.expires_at = 5000;
    sign_test_grant(&g);
    CHECK(controller_handle_release_request(&g) == GRANT_RESULT_RELEASED);
    CHECK(controller_get_high_water_counter() == 0xFFFFFFFFu);

    /* No uint32 value is strictly greater than UINT32_MAX: every further
     * grant is denied. Saturation fails closed instead of wrapping open. */
    hardware_grant_t g2;
    memset(&g2, 0, sizeof(g2));
    strcpy(g2.challenge, "challenge-max-2");
    strcpy(g2.policy_digest, TEST_POLICY_DIGEST);
    g2.monotonic_counter = 0; /* wraparound attempt */
    g2.expires_at = 5000;
    sign_test_grant(&g2);
    CHECK(controller_handle_release_request(&g2) == GRANT_RESULT_DENIED);

    hardware_grant_t g3;
    memset(&g3, 0, sizeof(g3));
    strcpy(g3.challenge, "challenge-max-3");
    strcpy(g3.policy_digest, TEST_POLICY_DIGEST);
    g3.monotonic_counter = 0xFFFFFFFFu; /* replay of the max itself */
    g3.expires_at = 5000;
    sign_test_grant(&g3);
    CHECK(controller_handle_release_request(&g3) == GRANT_RESULT_DENIED);
    TEST_END;
}

static void test_assert_isolated_reports_fresh_feedback(void) {
    TEST("assert_isolated re-reads feedback (stale closed reading fixed)");
    mock_reset();
    controller_init();
    provision_test_key();
    provision_test_policy();
    controller_update_time(1000);
    mock_set_feedback(true); /* relay physically closed */

    /* A valid grant releases the interlock; feedback_ok becomes true. */
    hardware_grant_t g;
    memset(&g, 0, sizeof(g));
    strcpy(g.challenge, "challenge-fresh-fb");
    strcpy(g.policy_digest, TEST_POLICY_DIGEST);
    g.monotonic_counter = 1;
    g.expires_at = 5000;
    sign_test_grant(&g);
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
    strcpy(g2.policy_digest, TEST_POLICY_DIGEST);
    g2.monotonic_counter = 2;
    g2.expires_at = 5000;
    sign_test_grant(&g2);
    CHECK(controller_handle_release_request(&g2) == GRANT_RESULT_RELEASED);
    mock_set_feedback(true); /* relay welded closed — pin stays high */
    controller_assert_isolated();
    CHECK(controller_get_state() == INTERLOCK_STATE_ISOLATED);
    CHECK(controller_get_feedback_ok() == true); /* truthfully reported */
    TEST_END;
}

/* ── FW-001 regression: M1<->M2 serial channel authentication ────────── */

static void test_grant_auth_rfc_vectors(void) {
    /* The HMAC implementation must match OFFICIAL vectors, not merely be
     * self-consistent: RFC 4231 test cases 1 & 2, and the FIPS 180-4
     * SHA-256 vector for "abc". */
    TEST("grant_auth: FIPS 180-4 SHA-256(\"abc\") vector");
    {
        uint8_t out[32];
        static const uint8_t expected[32] = {
            0xba,0x78,0x16,0xbf,0x8f,0x01,0xcf,0xea,0x41,0x41,0x40,0xde,0x5d,0xae,0x22,0x23,
            0xb0,0x03,0x61,0xa3,0x96,0x17,0x7a,0x9c,0xb4,0x10,0xff,0x61,0xf2,0x00,0x15,0xad
        };
        grant_auth_sha256((const uint8_t *)"abc", 3, out);
        CHECK(grant_auth_constant_time_equal(out, expected, 32) == true);
    }
    TEST_END;

    TEST("grant_auth: RFC 4231 HMAC-SHA256 test case 1");
    {
        uint8_t key[20];
        memset(key, 0x0b, sizeof(key));
        uint8_t out[32];
        static const uint8_t expected[32] = {
            0xb0,0x34,0x4c,0x61,0xd8,0xdb,0x38,0x53,0x5c,0xa8,0xaf,0xce,0xaf,0x0b,0xf1,0x2b,
            0x88,0x1d,0xc2,0x00,0xc9,0x83,0x3d,0xa7,0x26,0xe9,0x37,0x6c,0x2e,0x32,0xcf,0xf7
        };
        grant_auth_hmac_sha256(key, 20, (const uint8_t *)"Hi There", 8, out);
        CHECK(grant_auth_constant_time_equal(out, expected, 32) == true);
    }
    TEST_END;

    TEST("grant_auth: RFC 4231 HMAC-SHA256 test case 2");
    {
        uint8_t out[32];
        static const uint8_t expected[32] = {
            0x5b,0xdc,0xc1,0x46,0xbf,0x60,0x75,0x4e,0x6a,0x04,0x24,0x26,0x08,0x95,0x75,0xc7,
            0x5a,0x00,0x3f,0x08,0x9d,0x27,0x39,0x83,0x9d,0xec,0x58,0xb9,0x64,0xec,0x38,0x43
        };
        grant_auth_hmac_sha256((const uint8_t *)"Jefe", 4,
                               (const uint8_t *)"what do ya want for nothing?", 28, out);
        CHECK(grant_auth_constant_time_equal(out, expected, 32) == true);
    }
    TEST_END;
}

static void test_release_denied_without_channel_key(void) {
    /* THE core FW-001 regression: with no key provisioned, a structurally
     * perfect grant (correct digest, counter, expiry, feedback OK, even a
     * correctly computed MAC) is still DENIED. Previously such a frame —
     * forgeable by anyone on the UART — released the relay. MUST run before
     * any test calls provision_test_key(): key state starts unprovisioned at
     * process start and provisioning survives controller_init(). main()
     * enforces this ordering. */
    TEST("FW-001: release DENIED when no channel key provisioned (fail-closed)");
    mock_reset();
    controller_init();
    CHECK(controller_channel_key_provisioned() == false); /* precondition */
    /* Digest IS provisioned so the denial provably comes from the missing
     * key, not an earlier field check. */
    provision_test_policy();
    controller_update_time(1000);
    mock_set_feedback(true);

    hardware_grant_t grant;
    memset(&grant, 0, sizeof(grant));
    strcpy(grant.challenge, "challenge-nokey");
    strcpy(grant.policy_digest, TEST_POLICY_DIGEST);
    grant.monotonic_counter = 1;
    grant.expires_at = 5000;
    sign_test_grant(&grant); /* even a CORRECT MAC must not help: no key */

    CHECK(controller_handle_release_request(&grant) == GRANT_RESULT_DENIED);
    CHECK(controller_get_state() == INTERLOCK_STATE_ISOLATED);
    TEST_END;
}

static void test_release_denied_wrong_signature(void) {
    TEST("FW-001: release DENIED on wrong MAC (forged signature)");
    mock_reset();
    controller_init();
    provision_test_key();
    provision_test_policy();
    controller_update_time(1000);
    mock_set_feedback(true);

    hardware_grant_t grant;
    memset(&grant, 0, sizeof(grant));
    strcpy(grant.challenge, "challenge-badmac");
    strcpy(grant.policy_digest, TEST_POLICY_DIGEST);
    grant.monotonic_counter = 1;
    grant.expires_at = 5000;
    sign_test_grant(&grant);
    grant.signature[0] ^= 0xFFu; /* corrupt one byte */
    CHECK(controller_handle_release_request(&grant) == GRANT_RESULT_DENIED);
    CHECK(controller_get_state() == INTERLOCK_STATE_ISOLATED);
    TEST_END;
}

static void test_release_denied_tampered_field(void) {
    /* Sign for counter=5, then swap in counter=6: MAC no longer binds the
     * message. Proves the canonical message covers the counter (an attacker
     * cannot replay a captured frame with a bumped counter). */
    TEST("FW-001: MAC binds grant fields (tampered counter rejected)");
    mock_reset();
    controller_init();
    provision_test_key();
    provision_test_policy();
    controller_update_time(1000);
    mock_set_feedback(true);

    hardware_grant_t grant;
    memset(&grant, 0, sizeof(grant));
    strcpy(grant.challenge, "challenge-tamper");
    strcpy(grant.policy_digest, TEST_POLICY_DIGEST);
    grant.monotonic_counter = 5;
    grant.expires_at = 5000;
    sign_test_grant(&grant);
    grant.monotonic_counter = 6; /* bump after signing */
    CHECK(controller_handle_release_request(&grant) == GRANT_RESULT_DENIED);
    CHECK(controller_get_state() == INTERLOCK_STATE_ISOLATED);
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

    TEST("serial_json: signature hex parses to 32 MAC bytes");
    serial_json_parse(
        "{\"type\":\"command\",\"command\":\"interlock_release\","
        "\"challenge\":\"c-mac\",\"policyDigest\":\"d-mac\","
        "\"monotonicCounter\":9,\"expiresAt\":4000,"
        "\"signature\":\"00ff10ee20cc30aa40bb50996088707780669044a022b011c033d0f5e0a1\"}",
        &msg);
    /* 60 hex chars = 30 bytes (valid parse, non-32 length still parsed) */
    CHECK(msg.grant.signature_len == 30);
    CHECK(msg.grant.signature[0] == 0x00);
    CHECK(msg.grant.signature[1] == 0xff);
    CHECK(msg.grant.signature[2] == 0x10);
    TEST_END;

    TEST("serial_json: malformed signature yields signature_len 0 (fail-closed)");
    serial_json_parse(
        "{\"type\":\"command\",\"command\":\"interlock_release\","
        "\"challenge\":\"c-mac2\",\"signature\":\"zz\"}", &msg);
    CHECK(msg.grant.signature_len == 0);
    serial_json_parse(
        "{\"type\":\"command\",\"command\":\"interlock_release\","
        "\"challenge\":\"c-mac3\",\"signature\":\"abc\"}", &msg); /* odd length */
    CHECK(msg.grant.signature_len == 0);
    serial_json_parse(
        "{\"type\":\"command\",\"command\":\"interlock_release\","
        "\"challenge\":\"c-mac4\"}", &msg); /* absent field */
    CHECK(msg.grant.signature_len == 0);
    TEST_END;

    TEST("FW-003: negative/sentinel/overflow numbers parse as absent (deny)");
    /* "-1" used to strtoul-wrap to UINT32_MAX = never-expires. */
    serial_json_parse(
        "{\"type\":\"command\",\"command\":\"interlock_release\","
        "\"monotonicCounter\":\"-1\",\"expiresAt\":\"-1\"}", &msg);
    CHECK(msg.grant.monotonic_counter == 0);
    CHECK(msg.grant.expires_at == 0);
    /* "+5" is not a valid JSON number form for our fields either. */
    serial_json_parse(
        "{\"type\":\"command\",\"command\":\"interlock_release\","
        "\"monotonicCounter\":\"+5\",\"expiresAt\":\"+7\"}", &msg);
    CHECK(msg.grant.monotonic_counter == 0);
    CHECK(msg.grant.expires_at == 0);
    /* UINT32_MAX sentinel (never-expires) rejected on both fields. */
    serial_json_parse(
        "{\"type\":\"command\",\"command\":\"interlock_release\","
        "\"monotonicCounter\":4294967295,\"expiresAt\":4294967295}", &msg);
    CHECK(msg.grant.monotonic_counter == 0);
    CHECK(msg.grant.expires_at == 0);
    /* 11-digit overflow rejected. */
    serial_json_parse(
        "{\"type\":\"command\",\"command\":\"interlock_release\","
        "\"monotonicCounter\":99999999999,\"expiresAt\":99999999999}", &msg);
    CHECK(msg.grant.monotonic_counter == 0);
    CHECK(msg.grant.expires_at == 0);
    /* Boundary sanity: valid values still parse. */
    serial_json_parse(
        "{\"type\":\"command\",\"command\":\"interlock_release\","
        "\"monotonicCounter\":1,\"expiresAt\":4294967294}", &msg);
    CHECK(msg.grant.monotonic_counter == 1);
    CHECK(msg.grant.expires_at == 4294967294u);
    TEST_END;

    TEST("FW-004: time_sync frame parses; bad epochS flagged invalid");
    serial_json_parse("{\"type\":\"time_sync\",\"epochS\":1700000000}", &msg);
    CHECK(msg.type == MSG_TYPE_TIME_SYNC);
    CHECK(msg.time_valid == true);
    CHECK(msg.time_epoch_s == 1700000000u);
    serial_json_parse("{\"type\":\"time_sync\",\"epochS\":\"-1\"}", &msg);
    CHECK(msg.type == MSG_TYPE_TIME_SYNC);
    CHECK(msg.time_valid == false);
    serial_json_parse("{\"type\":\"time_sync\"}", &msg); /* absent */
    CHECK(msg.type == MSG_TYPE_TIME_SYNC);
    CHECK(msg.time_valid == false);
    TEST_END;
}

int main(void) {
    /* Unbuffered stdout: on a crash (access violation) the stdio buffer is
     * lost, hiding the last-started test — the exact line needed to locate
     * the fault (learned the hard way during the FW-006 dangling-store fix). */
    setvbuf(stdout, NULL, _IONBF, 0);
    printf("\n=== M2 Controller Tasks Host Tests ===\n\n");
    /* FW-001 ordering: the unprovisioned-key test MUST run before any test
     * provisions the channel key (key state persists across controller_init
     * within one process). */
    test_release_denied_without_channel_key();
    test_grant_auth_rfc_vectors();
    test_boot_isolated();
    test_challenge_dedup();
    test_serial_json_parsing();
    test_policy_digest();
    test_monotonic_counter();
    test_counter_advances_on_release();
    test_counter_store_survives_power_cycle();
    test_counter_store_save_failure_revokes_release();
    test_expiry();
    test_expiry_requires_time_sync();
    test_time_sync_rewind_rejected();
    test_release_denied_without_time_sync();
    test_estop();
    test_estop_latch_blocks_release();
    test_counter_saturates_at_uint32_max();
    test_challenge_ring_eviction_window();
    test_release_with_valid_grant();
    test_release_blocked_no_feedback();
    test_release_blocked_bad_policy();
    test_release_denied_wrong_signature();
    test_release_denied_tampered_field();
    test_assert_isolated_reports_fresh_feedback();
    printf("\n=== Results: %d passed, %d failed ===\n", tests_passed, tests_failed);
    return tests_failed > 0 ? 1 : 0;
}

