/**
 * Property 2: Button Debounce Correctness
 *
 * For any sequence of GPIO level transitions on a single button input that
 * occur within a 50 ms window, the firmware debounce logic shall register
 * exactly one button event — regardless of how many raw transitions occurred.
 *
 * Also verifies: sequences spanning > 50 ms produce exactly one event per
 * distinct press-release pair.
 *
 * Host-side test harness using Unity test framework.
 * Validates: Requirement 7.5
 *
 * Build: pio test -e host (requires [env:host] in platformio.ini)
 */

#include <unity.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Mock Arduino environment
// ---------------------------------------------------------------------------
static uint32_t mock_millis_value = 0;
static uint8_t  mock_pin_state[40] = {};  // indexed by pin number

uint32_t millis() { return mock_millis_value; }
void     pinMode(uint8_t, uint8_t) {}
uint8_t  digitalRead(uint8_t pin) { return mock_pin_state[pin]; }
void     digitalWrite(uint8_t, uint8_t) {}

#define INPUT_PULLUP 0x02
#define HIGH 1
#define LOW  0

// ---------------------------------------------------------------------------
// Include the unit under test (header-only)
// ---------------------------------------------------------------------------
#include "../../src/button_handler.h"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
static void reset_mock(uint8_t pin) {
    mock_millis_value = 0;
    mock_pin_state[pin] = HIGH;  // idle = HIGH (INPUT_PULLUP)
}

static uint8_t count_events(ButtonEventQueue& q) {
    uint8_t count = 0;
    ButtonEvent evt;
    while (q.dequeue(evt)) { ++count; }
    return count;
}

// ---------------------------------------------------------------------------
// Test: Single clean press-release within 50 ms window → exactly 1 event
// ---------------------------------------------------------------------------
void test_single_press_one_event(void) {
    ButtonEventQueue queue;
    SingleButton btn;
    btn.init(18, BTN_OK, &queue);
    reset_mock(18);

    // t=0: press (falling edge)
    mock_pin_state[18] = LOW;
    mock_millis_value = 0;
    btn.poll();

    // t=10: still pressed (within debounce window)
    mock_millis_value = 10;
    btn.poll();

    // t=60: release (rising edge, after debounce window)
    mock_millis_value = 60;
    mock_pin_state[18] = HIGH;
    btn.poll();

    // t=120: stable
    mock_millis_value = 120;
    btn.poll();

    TEST_ASSERT_EQUAL_UINT8(1, count_events(queue));
}

// ---------------------------------------------------------------------------
// Test: Multiple bounces within 50 ms window → exactly 1 event
// ---------------------------------------------------------------------------
void test_bouncy_press_one_event(void) {
    ButtonEventQueue queue;
    SingleButton btn;
    btn.init(18, BTN_OK, &queue);
    reset_mock(18);

    // Simulate 8 bounces within 0–49 ms
    for (int i = 0; i < 8; ++i) {
        mock_millis_value = i * 5;  // 0, 5, 10, 15, 20, 25, 30, 35 ms
        mock_pin_state[18] = (i % 2 == 0) ? LOW : HIGH;
        btn.poll();
    }

    // t=60: stable release (after debounce window)
    mock_millis_value = 60;
    mock_pin_state[18] = HIGH;
    btn.poll();

    mock_millis_value = 120;
    btn.poll();

    TEST_ASSERT_EQUAL_UINT8(1, count_events(queue));
}

// ---------------------------------------------------------------------------
// Test: 20 rapid transitions within 49 ms → exactly 1 event
// ---------------------------------------------------------------------------
void test_20_transitions_within_window_one_event(void) {
    ButtonEventQueue queue;
    SingleButton btn;
    btn.init(18, BTN_OK, &queue);
    reset_mock(18);

    // 20 transitions in 0–49 ms (2.45 ms apart)
    for (int i = 0; i < 20; ++i) {
        mock_millis_value = (uint32_t)(i * 2);  // 0..38 ms
        mock_pin_state[18] = (i % 2 == 0) ? LOW : HIGH;
        btn.poll();
    }

    // Final state: HIGH (released) at t=60 (after debounce)
    mock_millis_value = 60;
    mock_pin_state[18] = HIGH;
    btn.poll();

    mock_millis_value = 120;
    btn.poll();

    TEST_ASSERT_EQUAL_UINT8(1, count_events(queue));
}

// ---------------------------------------------------------------------------
// Test: Two distinct press-release pairs > 50 ms apart → exactly 2 events
// ---------------------------------------------------------------------------
void test_two_distinct_presses_two_events(void) {
    ButtonEventQueue queue;
    SingleButton btn;
    btn.init(18, BTN_OK, &queue);
    reset_mock(18);

    // First press at t=0, release at t=100
    mock_millis_value = 0;
    mock_pin_state[18] = LOW;
    btn.poll();

    mock_millis_value = 100;
    mock_pin_state[18] = HIGH;
    btn.poll();

    mock_millis_value = 160;
    btn.poll();

    // Second press at t=300, release at t=400
    mock_millis_value = 300;
    mock_pin_state[18] = LOW;
    btn.poll();

    mock_millis_value = 400;
    mock_pin_state[18] = HIGH;
    btn.poll();

    mock_millis_value = 460;
    btn.poll();

    TEST_ASSERT_EQUAL_UINT8(2, count_events(queue));
}

// ---------------------------------------------------------------------------
// Test: Continuously held button → exactly 1 event (no repeat)
// ---------------------------------------------------------------------------
void test_held_button_no_repeat(void) {
    ButtonEventQueue queue;
    SingleButton btn;
    btn.init(18, BTN_OK, &queue);
    reset_mock(18);

    // Press at t=0
    mock_millis_value = 0;
    mock_pin_state[18] = LOW;
    btn.poll();

    // Hold for 5 seconds, polling every 10 ms
    for (uint32_t t = 10; t <= 5000; t += 10) {
        mock_millis_value = t;
        btn.poll();
    }

    // Release at t=5100
    mock_millis_value = 5100;
    mock_pin_state[18] = HIGH;
    btn.poll();

    mock_millis_value = 5200;
    btn.poll();

    TEST_ASSERT_EQUAL_UINT8(1, count_events(queue));
}

// ---------------------------------------------------------------------------
// Test: Three buttons produce correct event identifiers
// ---------------------------------------------------------------------------
void test_three_buttons_correct_event_ids(void) {
    ButtonEventQueue queue;
    SingleButton btnOK, btnNext, btnBack;
    btnOK.init(18, BTN_OK, &queue);
    btnNext.init(19, BTN_NEXT, &queue);
    btnBack.init(23, BTN_BACK, &queue);

    reset_mock(18);
    reset_mock(19);
    reset_mock(23);

    // Press and release OK
    mock_millis_value = 0;
    mock_pin_state[18] = LOW;
    btnOK.poll();
    mock_millis_value = 100;
    mock_pin_state[18] = HIGH;
    btnOK.poll();
    mock_millis_value = 160;
    btnOK.poll();

    // Press and release NEXT
    mock_millis_value = 200;
    mock_pin_state[19] = LOW;
    btnNext.poll();
    mock_millis_value = 300;
    mock_pin_state[19] = HIGH;
    btnNext.poll();
    mock_millis_value = 360;
    btnNext.poll();

    // Press and release BACK
    mock_millis_value = 400;
    mock_pin_state[23] = LOW;
    btnBack.poll();
    mock_millis_value = 500;
    mock_pin_state[23] = HIGH;
    btnBack.poll();
    mock_millis_value = 560;
    btnBack.poll();

    ButtonEvent e1, e2, e3;
    TEST_ASSERT_TRUE(queue.dequeue(e1));
    TEST_ASSERT_TRUE(queue.dequeue(e2));
    TEST_ASSERT_TRUE(queue.dequeue(e3));
    TEST_ASSERT_EQUAL_INT(BTN_OK,   e1);
    TEST_ASSERT_EQUAL_INT(BTN_NEXT, e2);
    TEST_ASSERT_EQUAL_INT(BTN_BACK, e3);
    TEST_ASSERT_FALSE(queue.dequeue(e1));  // queue empty
}

// ---------------------------------------------------------------------------
// Test: Queue capacity — overflow drops events gracefully
// ---------------------------------------------------------------------------
void test_queue_capacity_overflow(void) {
    ButtonEventQueue queue;
    // Fill queue to capacity
    for (uint8_t i = 0; i < ButtonEventQueue::CAPACITY; ++i) {
        TEST_ASSERT_TRUE(queue.enqueue(BTN_OK));
    }
    // One more should fail (queue full)
    TEST_ASSERT_FALSE(queue.enqueue(BTN_OK));
    TEST_ASSERT_EQUAL_UINT8(ButtonEventQueue::CAPACITY, queue.size());
}

// ---------------------------------------------------------------------------
// Test: FIFO ordering preserved
// ---------------------------------------------------------------------------
void test_queue_fifo_order(void) {
    ButtonEventQueue queue;
    queue.enqueue(BTN_OK);
    queue.enqueue(BTN_NEXT);
    queue.enqueue(BTN_BACK);

    ButtonEvent e;
    queue.dequeue(e); TEST_ASSERT_EQUAL_INT(BTN_OK,   e);
    queue.dequeue(e); TEST_ASSERT_EQUAL_INT(BTN_NEXT, e);
    queue.dequeue(e); TEST_ASSERT_EQUAL_INT(BTN_BACK, e);
    TEST_ASSERT_FALSE(queue.dequeue(e));
}

// ---------------------------------------------------------------------------
// Unity entry point
// ---------------------------------------------------------------------------
int main(void) {
    UNITY_BEGIN();

    RUN_TEST(test_single_press_one_event);
    RUN_TEST(test_bouncy_press_one_event);
    RUN_TEST(test_20_transitions_within_window_one_event);
    RUN_TEST(test_two_distinct_presses_two_events);
    RUN_TEST(test_held_button_no_repeat);
    RUN_TEST(test_three_buttons_correct_event_ids);
    RUN_TEST(test_queue_capacity_overflow);
    RUN_TEST(test_queue_fifo_order);

    return UNITY_END();
}
