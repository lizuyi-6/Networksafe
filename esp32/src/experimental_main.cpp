/**
 * Experimental cloud-module compile smoke entrypoint.
 *
 * This file exists only to verify that the experimental transport,
 * collector, crypto, codebook, and AI modules still compile together.
 * It is not part of the active serial deployer runtime.
 */

#include <Arduino.h>
#include <WebSocketsClient.h>
#include "config.h"
#include "transport.h"
#include "collector.h"
#include "crypto.h"
#include "codebook.h"
#include "ai_model.h"

#if !ENABLE_EXPERIMENTAL_CLOUD
#error "experimental_main.cpp requires ENABLE_EXPERIMENTAL_CLOUD=1"
#endif

static WebSocketsClient cloudSocket;
static Transport transport;
static Collector collector;
static Crypto crypto;
static Codebook codebook;
static AIModel aiModel;

void setup() {
    Serial.begin(115200);

    transport.init(&cloudSocket);
    collector.init();
    crypto.init("0123456789abcdef", "fedcba9876543210", CRYPTO_NONE);
    codebook.init();
    aiModel.init();
}

void loop() {
    delay(1000);
}
