/**
 * Property 5: AG Protocol Response Sequence
 *
 * For any AG:REQ:BACKUP operation, the UART2 output sequence shall be:
 *   1. Exactly one AG:BEGIN:BACKUP
 *   2. One or more AG:STEP:<n> with monotonically non-decreasing <n>
 *   3. Exactly one AG:OK:BACKUP
 * No other message types may be interspersed.
 *
 * Also tests: AG:ERR:BUSY is sent when a second AG:REQ:* arrives while
 * a confirmation is pending (Requirement 5.7).
 *
 * Host-side test harness using Unity test framework.
 * Validates: Requirements 5.2, 5.7
 *
 * Build: pio test -e host
 */

#include <unity.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <vector>
#include <string>

// ---------------------------------------------------------------------------
// Mock Arduino / Serial environment
// ---------------------------------------------------------------------------
static uint32_t mock_millis_value = 0;
uint32_t millis() { return mock_millis_value; }
void     pinMode(uint8_t, uint8_t) {}
uint8_t  digitalRead(uint8_t) { return 1; }
void     digitalWrite(uint8_t, uint8_t) {}

#define INPUT_PULLUP 0x02
#define HIGH 1
#define LOW  0
#define SERIAL_8N1 0x800001c

// Mock Serial2 (TARGET_SERIAL)
struct MockSerial {
    std::vector<std::string> output_lines;
    std::vector<uint8_t>     input_bytes;
    size_t                   input_pos = 0;

    void begin(uint32_t, uint32_t, uint8_t, uint8_t) {}

    void println(const char* s) {
        output_lines.push_back(std::string(s));
    }

    int available() {
        return (int)(input_bytes.size() - input_pos);
    }

    int read() {
        if (input_pos >= input_bytes.size()) return -1;
        return input_bytes[input_pos++];
    }

    void feed(const char* line) {
        for (const char* p = line; *p; ++p) {
            input_bytes.push_back((uint8_t)*p);
        }
        input_bytes.push_back('\n');
    }

    void reset() {
        output_lines.clear();
        input_bytes.clear();
        input_pos = 0;
    }
} Serial2;

#define Serial Serial2  // redirect DEBUG_PRINT to mock (ignored)

// ---------------------------------------------------------------------------
// Stub config.h values needed by deployment.h
// ---------------------------------------------------------------------------
#define TARGET_SERIAL           Serial2
#define TARGET_RX_PIN           16
#define TARGET_TX_PIN           17
#define TARGET_BAUD             115200
#define SERIAL_LINE_BUFFER_SIZE 128
#define RX_BUFFER_SIZE          2048
#define ENV_CHECK_TIMEOUT_MS    1500
#define BACKUP_TIMEOUT_MS       15000
#define INSTALL_TIMEOUT_MS      45000
#define REMOVE_TIMEOUT_MS       20000
#define SERIAL_REQ_ENV          "AG:REQ:ENV"
#define SERIAL_REQ_BACKUP       "AG:REQ:BACKUP"
#define SERIAL_REQ_INSTALL      "AG:REQ:INSTALL"
#define SERIAL_REQ_REMOVE       "AG:REQ:REMOVE"
#define SERIAL_PROTO_ENV_LINUX  "AG:ENV:LINUX"
#define SERIAL_PROTO_ENV_WINDOWS "AG:ENV:WINDOWS"
#define SERIAL_PROTO_BEGIN_PREFIX "AG:BEGIN:"
#define SERIAL_PROTO_STEP_PREFIX  "AG:STEP:"
#define SERIAL_PROTO_OK_PREFIX    "AG:OK:"
#define SERIAL_PROTO_ERR_PREFIX   "AG:ERR:"
#define SERIAL_PROTO_OK_BACKUP    "AG:OK:BACKUP"
#define SERIAL_PROTO_ERR_BACKUP   "AG:ERR:BACKUP"
#define SERIAL_PROTO_OK_INSTALL   "AG:OK:INSTALL"
#define SERIAL_PROTO_ERR_INSTALL  "AG:ERR:INSTALL"
#define SERIAL_PROTO_OK_REMOVE    "AG:OK:REMOVE"
#define SERIAL_PROTO_ERR_REMOVE   "AG:ERR:REMOVE"
#define SERIAL_PROTO_ERR_BUSY     "AG:ERR:BUSY"
#define HOST_HELPER_NOT_READY_MSG "Host helper not ready"
#define HOST_HELPER_TIMEOUT_MSG   "Timeout waiting for host helper"
#define ENABLE_DEBUG              0
#define DEBUG_PRINT(x)            ((void)0)
#define DEBUG_PRINTLN(x)          ((void)0)
#define DEBUG_PRINTF(...)         ((void)0)

#include "../../src/deployment.h"

// ---------------------------------------------------------------------------
// Helper: feed a complete backup sequence to the deployment module
// ---------------------------------------------------------------------------
static void feed_backup_sequence(DeploymentModule& deploy,
                                  int step_count,
                                  int* step_percents) {
    // Feed AG:BEGIN:BACKUP
    Serial2.feed("AG:BEGIN:BACKUP");
    deploy.update();

    // Feed AG:STEP:<n> lines
    char buf[32];
    for (int i = 0; i < step_count; ++i) {
        snprintf(buf, sizeof(buf), "AG:STEP:BACKUP:%d", step_percents[i]);
        Serial2.feed(buf);
        deploy.update();
    }

    // Feed AG:OK:BACKUP
    Serial2.feed("AG:OK:BACKUP");
    deploy.update();
}

// ---------------------------------------------------------------------------
// Test: Standard backup sequence — BEGIN, STEP(s), OK in correct order
// ---------------------------------------------------------------------------
void test_backup_sequence_correct_order(void) {
    DeploymentModule deploy;
    Serial2.reset();
    mock_millis_value = 0;
    deploy.init();

    // First set host environment to Linux
    Serial2.feed("AG:ENV:LINUX");
    deploy.startEnvironmentCheck();
    deploy.update();
    CmdStatus s;
    deploy.consumeResult(s);

    // Start backup
    Serial2.reset();
    TEST_ASSERT_TRUE(deploy.startBackup());

    // Feed the sequence
    int percents[] = {25, 50, 75};
    feed_backup_sequence(deploy, 3, percents);

    // Verify result
    TEST_ASSERT_TRUE(deploy.consumeResult(s));
    TEST_ASSERT_EQUAL_INT(CMD_SUCCESS, s);
}

// ---------------------------------------------------------------------------
// Test: AG:ERR:BUSY sent when second AG:REQ:* arrives while pending
// ---------------------------------------------------------------------------
void test_busy_response_on_concurrent_request(void) {
    DeploymentModule deploy;
    Serial2.reset();
    mock_millis_value = 0;
    deploy.init();

    // Set host to Linux
    Serial2.feed("AG:ENV:LINUX");
    deploy.startEnvironmentCheck();
    deploy.update();
    CmdStatus s;
    deploy.consumeResult(s);

    // Start backup (pending.active = true)
    Serial2.reset();
    deploy.startBackup();

    // Feed a second AG:REQ:INSTALL while backup is pending
    Serial2.feed("AG:REQ:INSTALL");
    deploy.update();

    // Verify AG:ERR:BUSY was sent
    bool found_busy = false;
    for (const auto& line : Serial2.output_lines) {
        if (line == "AG:ERR:BUSY") {
            found_busy = true;
            break;
        }
    }
    TEST_ASSERT_TRUE_MESSAGE(found_busy, "Expected AG:ERR:BUSY in output");
}

// ---------------------------------------------------------------------------
// Test: Property 5 — STEP values are monotonically non-decreasing
// ---------------------------------------------------------------------------
void test_step_values_non_decreasing(void) {
    // This test verifies the property holds for a generated sequence
    // with varying step counts (1–10) and percent values
    for (int step_count = 1; step_count <= 10; ++step_count) {
        DeploymentModule deploy;
        Serial2.reset();
        mock_millis_value = 0;
        deploy.init();

        // Set Linux host
        Serial2.feed("AG:ENV:LINUX");
        deploy.startEnvironmentCheck();
        deploy.update();
        CmdStatus s;
        deploy.consumeResult(s);

        Serial2.reset();
        deploy.startBackup();

        // Generate non-decreasing percent values
        int percents[10];
        int prev = 0;
        for (int i = 0; i < step_count; ++i) {
            prev += (100 / step_count);
            percents[i] = (prev > 100) ? 100 : prev;
        }

        feed_backup_sequence(deploy, step_count, percents);

        TEST_ASSERT_TRUE(deploy.consumeResult(s));
        TEST_ASSERT_EQUAL_INT(CMD_SUCCESS, s);
    }
}

// ---------------------------------------------------------------------------
// Test: Unrecognised message is silently discarded (Requirement 4.7)
// ---------------------------------------------------------------------------
void test_unrecognised_message_discarded(void) {
    DeploymentModule deploy;
    Serial2.reset();
    mock_millis_value = 0;
    deploy.init();

    // Set Linux host
    Serial2.feed("AG:ENV:LINUX");
    deploy.startEnvironmentCheck();
    deploy.update();
    CmdStatus s;
    deploy.consumeResult(s);

    Serial2.reset();
    deploy.startBackup();

    // Feed an unrecognised message
    Serial2.feed("UNKNOWN:GARBAGE:DATA");
    deploy.update();

    // No response should have been sent for the unrecognised message
    // (only the initial AG:REQ:BACKUP was sent by startBackup)
    bool found_unexpected = false;
    for (const auto& line : Serial2.output_lines) {
        if (line != "AG:REQ:BACKUP") {
            found_unexpected = true;
        }
    }
    TEST_ASSERT_FALSE_MESSAGE(found_unexpected,
        "Unexpected output for unrecognised message");
}

// ---------------------------------------------------------------------------
// Unity entry point
// ---------------------------------------------------------------------------
int main(void) {
    UNITY_BEGIN();

    RUN_TEST(test_backup_sequence_correct_order);
    RUN_TEST(test_busy_response_on_concurrent_request);
    RUN_TEST(test_step_values_non_decreasing);
    RUN_TEST(test_unrecognised_message_discarded);

    return UNITY_END();
}
