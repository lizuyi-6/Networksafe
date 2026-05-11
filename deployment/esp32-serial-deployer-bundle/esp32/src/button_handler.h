/**
 * AetherGuard ESP32 - Button Event Queue Handler
 *
 * Implements a discrete event queue for button presses.
 * On rising-edge detection (release), exactly one ButtonEvent is enqueued.
 * All GPIO transitions within the 50 ms debounce window are suppressed.
 * A continuously held button does NOT generate repeat events.
 *
 * Requirements: 7.5, 7.6
 */

#ifndef BUTTON_HANDLER_H
#define BUTTON_HANDLER_H

#include <Arduino.h>
#include "config.h"

// ---------------------------------------------------------------------------
// ButtonEvent — discrete event identifiers consumed by the application layer
// ---------------------------------------------------------------------------
enum ButtonEvent : uint8_t {
    BTN_OK   = 0,
    BTN_NEXT = 1,
    BTN_BACK = 2
};

// ---------------------------------------------------------------------------
// ButtonEventQueue — fixed-size circular FIFO (capacity 8)
// ---------------------------------------------------------------------------
class ButtonEventQueue {
public:
    static constexpr uint8_t CAPACITY = 8;

    ButtonEventQueue() : head_(0), tail_(0), count_(0) {}

    bool enqueue(ButtonEvent evt) {
        if (count_ >= CAPACITY) {
            return false;  // queue full — drop event
        }
        queue_[tail_] = evt;
        tail_ = (tail_ + 1) % CAPACITY;
        ++count_;
        return true;
    }

    bool dequeue(ButtonEvent& out) {
        if (count_ == 0) {
            return false;
        }
        out = queue_[head_];
        head_ = (head_ + 1) % CAPACITY;
        --count_;
        return true;
    }

    bool isEmpty() const { return count_ == 0; }
    uint8_t size() const { return count_; }

private:
    ButtonEvent queue_[CAPACITY];
    uint8_t head_;
    uint8_t tail_;
    uint8_t count_;
};

// ---------------------------------------------------------------------------
// SingleButton — debounced rising-edge detector (enqueues on release)
// ---------------------------------------------------------------------------
class SingleButton {
public:
    static constexpr uint32_t DEBOUNCE_MS = 50;

    void init(uint8_t pin, ButtonEvent eventId, ButtonEventQueue* queue) {
        pin_      = pin;
        eventId_  = eventId;
        queue_    = queue;
        lastState_       = HIGH;   // INPUT_PULLUP: idle = HIGH
        waitingRelease_  = false;
        debounceStart_   = 0;
        inDebounce_      = false;
        pinMode(pin_, INPUT_PULLUP);
    }

    // Call once per loop() tick.
    void poll() {
        const uint32_t now    = millis();
        const bool     reading = digitalRead(pin_);

        // --- Debounce suppression window ---
        if (inDebounce_) {
            if (now - debounceStart_ < DEBOUNCE_MS) {
                // Still inside debounce window — ignore all transitions
                lastState_ = reading;
                return;
            }
            inDebounce_ = false;
        }

        // --- Edge detection ---
        if (reading != lastState_) {
            // Any edge starts the debounce window
            debounceStart_ = now;
            inDebounce_    = true;

            if (reading == LOW && !waitingRelease_) {
                // Falling edge (press): arm for release
                waitingRelease_ = true;
            } else if (reading == HIGH && waitingRelease_) {
                // Rising edge (release): enqueue exactly one event
                waitingRelease_ = false;
                if (queue_) {
                    queue_->enqueue(eventId_);
                }
            }

            lastState_ = reading;
        }
    }

private:
    uint8_t          pin_;
    ButtonEvent      eventId_;
    ButtonEventQueue* queue_;
    bool             lastState_;
    bool             waitingRelease_;
    bool             inDebounce_;
    uint32_t         debounceStart_;
};

// ---------------------------------------------------------------------------
// MultiButtonHandler — manages OK / Next / Back buttons and shared event queue
// ---------------------------------------------------------------------------
class MultiButtonHandler {
public:
    MultiButtonHandler() {}

    void init() {
        btnOK_.init(PIN_BTN_OK,   BTN_OK,   &queue_);
        btnNext_.init(PIN_BTN_NEXT, BTN_NEXT, &queue_);
        btnBack_.init(PIN_BTN_BACK, BTN_BACK, &queue_);
    }

    // Call once per loop() tick to poll all buttons.
    void update() {
        btnOK_.poll();
        btnNext_.poll();
        btnBack_.poll();
    }

    // Consume the next event from the queue (FIFO order).
    // Returns true and sets `out` if an event was available.
    bool dequeue(ButtonEvent& out) {
        return queue_.dequeue(out);
    }

    bool hasEvents() const {
        return !queue_.isEmpty();
    }

    // ---------------------------------------------------------------------------
    // Legacy compatibility helpers — kept so existing call sites in main.cpp
    // continue to compile. Each call drains one event of the matching type.
    // Prefer dequeue() for new code.
    // ---------------------------------------------------------------------------
    bool isOkClicked() {
        return peekAndConsume(BTN_OK);
    }

    bool isNextClicked() {
        return peekAndConsume(BTN_NEXT);
    }

    bool isBackClicked() {
        return peekAndConsume(BTN_BACK);
    }

private:
    SingleButton     btnOK_;
    SingleButton     btnNext_;
    SingleButton     btnBack_;
    ButtonEventQueue queue_;

    // Scan the queue for the first event matching `target`.
    // If found, remove it and return true.
    bool peekAndConsume(ButtonEvent target) {
        // Drain up to CAPACITY events looking for target; re-enqueue others.
        const uint8_t n = queue_.size();
        for (uint8_t i = 0; i < n; ++i) {
            ButtonEvent evt;
            if (!queue_.dequeue(evt)) break;
            if (evt == target) {
                return true;  // found — consumed, discard others for this call
            }
            queue_.enqueue(evt);  // put back
        }
        return false;
    }
};

#endif // BUTTON_HANDLER_H
