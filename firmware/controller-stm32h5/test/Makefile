# Host-side unit test Makefile for M2 controller_tasks
#
# Compiles firmware application code with mock HAL and runs tests on host.
# Verifies controller logic without STM32 hardware.
#
# Run: make test

CC = gcc
CFLAGS = -Wall -Wextra -std=c11 -g -Itest -ICore/Inc -ICore/Src

# Mock HAL + test framework
TEST_SRCS = \
	test/mock_hal.c \
	test/test_stubs.c \
	test/test_controller.c

# Firmware sources under test
FW_SRCS = \
	Core/Src/controller_tasks.c \
	Core/Src/serial_json.c \
	Core/Src/interlock_driver.c \
	Core/Src/grant_auth.c

# Exclude main.c (has infinite loop) and se_driver.c (stub-only, not needed)
# Note: se_driver.c references hi2c1 which is in test_stubs.c, but its functions
# return false/are stubs; we don't test SE here.

TARGET = test_controller

.PHONY: test clean

test: $(TARGET)
	./$(TARGET)

$(TARGET): $(TEST_SRCS) $(FW_SRCS)
	$(CC) $(CFLAGS) -o $(TARGET) $(TEST_SRCS) $(FW_SRCS)

clean:
	rm -f $(TARGET)
