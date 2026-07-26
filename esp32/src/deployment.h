/**
 * AetherGuard ESP32 - 非阻塞自动化部署模块
 *
 * 当前 v1 通过固定 allow-list 串口请求与主机侧 helper 通信。ESP32 只发送
 * AG:REQ:* 请求，不再把任意 shell 直接写到串口上。Linux 主机上的 helper
 * 负责执行环境检测、备份、安装和卸载，并返回 AG:* 标记回包。
 */

#ifndef DEPLOYMENT_H
#define DEPLOYMENT_H

#include <Arduino.h>
#include <SPIFFS.h>
#include "config.h"

enum CmdStatus {
    CMD_SUCCESS = 0,
    CMD_FAIL,
    CMD_REQUIRE_CONFIRM,
    CMD_BACKUP_FAIL
};

enum HostEnvironment {
    HOST_UNKNOWN = 0,
    HOST_LINUX,
    HOST_WINDOWS
};

enum DeployOperation {
    OP_NONE = 0,
    OP_ENV,
    OP_BACKUP,
    OP_INSTALL,
    OP_REMOVE
};

class DeploymentModule {
private:
    struct PendingCommand {
        DeployOperation type;
        bool active;
        uint32_t startedAt;
        uint32_t timeoutMs;
        size_t lineLen;
        bool lineOverflow;
        bool sawProtocolResponse;
        int progress;
    };

    char lastMessage[96];
    char lineBuffer[SERIAL_LINE_BUFFER_SIZE];
    HostEnvironment hostEnvironment;
    PendingCommand pending;
    CmdStatus lastStatus;
    bool completionPending;

    void resetPending() {
        pending.type = OP_NONE;
        pending.active = false;
        pending.startedAt = 0;
        pending.timeoutMs = 0;
        pending.lineLen = 0;
        pending.lineOverflow = false;
        pending.sawProtocolResponse = false;
        pending.progress = 0;
        memset(lineBuffer, 0, sizeof(lineBuffer));
    }

    void setLastMessage(const char* message) {
        if (!message) {
            lastMessage[0] = '\0';
            return;
        }

        strncpy(lastMessage, message, sizeof(lastMessage) - 1);
        lastMessage[sizeof(lastMessage) - 1] = '\0';
    }

    void setLastMessagef(const char* format, const char* arg1, const char* arg2 = nullptr) {
        snprintf(lastMessage, sizeof(lastMessage), format, arg1 ? arg1 : "", arg2 ? arg2 : "");
        lastMessage[sizeof(lastMessage) - 1] = '\0';
    }

    const char* actionTagFor(DeployOperation operation) const {
        switch (operation) {
            case OP_ENV:
                return "ENV";
            case OP_BACKUP:
                return "BACKUP";
            case OP_INSTALL:
                return "INSTALL";
            case OP_REMOVE:
                return "REMOVE";
            case OP_NONE:
            default:
                return "";
        }
    }

    const char* requestLineFor(DeployOperation operation) const {
        switch (operation) {
            case OP_ENV:
                return SERIAL_REQ_ENV;
            case OP_BACKUP:
                return SERIAL_REQ_BACKUP;
            case OP_INSTALL:
                return SERIAL_REQ_INSTALL;
            case OP_REMOVE:
                return SERIAL_REQ_REMOVE;
            case OP_NONE:
            default:
                return nullptr;
        }
    }

    bool actionMatchesPending(const char* action) const {
        if (!action || !pending.active) {
            return false;
        }
        return strcmp(actionTagFor(pending.type), action) == 0;
    }

    void markProtocolResponse() {
        if (pending.active) {
            pending.sawProtocolResponse = true;
        }
    }

    void clearSerialInput() {
        while (TARGET_SERIAL.available()) {
            TARGET_SERIAL.read();
        }
        pending.lineLen = 0;
        pending.lineOverflow = false;
    }

    void complete(CmdStatus status, const char* message, int progress = -1) {
        if (progress >= 0) {
            pending.progress = progress;
        }

        if (message) {
            setLastMessage(message);
        }

        lastStatus = status;
        completionPending = true;
        pending.active = false;
        pending.type = OP_NONE;
    }

    bool startRequest(DeployOperation operation, uint32_t timeoutMs, int initialProgress, const char* statusMessage) {
        const char* requestLine = requestLineFor(operation);
        if (pending.active || !requestLine) {
            return false;
        }

        clearSerialInput();
        pending.type = operation;
        pending.active = true;
        pending.startedAt = millis();
        pending.timeoutMs = timeoutMs;
        pending.progress = initialProgress;
        pending.sawProtocolResponse = false;
        completionPending = false;

        if (statusMessage) {
            setLastMessage(statusMessage);
        }

        TARGET_SERIAL.println(requestLine);
        return true;
    }

    bool startActionRequest(DeployOperation operation, uint32_t timeoutMs, int initialProgress) {
        char statusText[48];
        snprintf(statusText, sizeof(statusText), "Queued %s", actionTagFor(operation));
        return startRequest(operation, timeoutMs, initialProgress, statusText);
    }

    void parseMarkerPayload(const char* payload, char* action, size_t actionSize, char* detail, size_t detailSize) {
        if (actionSize > 0) {
            action[0] = '\0';
        }
        if (detailSize > 0) {
            detail[0] = '\0';
        }
        if (!payload) {
            return;
        }

        const char* separator = strchr(payload, ':');
        if (!separator) {
            strncpy(action, payload, actionSize - 1);
            action[actionSize - 1] = '\0';
            return;
        }

        size_t actionLen = min(static_cast<size_t>(separator - payload), actionSize - 1);
        memcpy(action, payload, actionLen);
        action[actionLen] = '\0';

        strncpy(detail, separator + 1, detailSize - 1);
        detail[detailSize - 1] = '\0';
    }

    void handleBeginMarker(const char* payload) {
        char action[16];
        char detail[32];
        parseMarkerPayload(payload, action, sizeof(action), detail, sizeof(detail));

        if (!actionMatchesPending(action)) {
            return;
        }

        markProtocolResponse();

        if (pending.type == OP_BACKUP) {
            pending.progress = 20;
        } else if (pending.type == OP_INSTALL || pending.type == OP_REMOVE) {
            pending.progress = 15;
        }

        setLastMessagef("Starting %s", action);
    }

    void handleStepMarker(const char* payload) {
        char action[16];
        char detail[32];
        parseMarkerPayload(payload, action, sizeof(action), detail, sizeof(detail));

        if (!actionMatchesPending(action)) {
            return;
        }

        markProtocolResponse();

        if (pending.type == OP_BACKUP) {
            pending.progress = 70;
        } else if (pending.type == OP_INSTALL || pending.type == OP_REMOVE) {
            pending.progress = 55;
        }

        if (detail[0] != '\0') {
            setLastMessagef("%s: %s", action, detail);
        } else {
            setLastMessagef("%s running", action);
        }
    }

    void handleOkMarker(const char* payload) {
        char action[16];
        char detail[32];
        parseMarkerPayload(payload, action, sizeof(action), detail, sizeof(detail));

        if (!actionMatchesPending(action)) {
            return;
        }

        markProtocolResponse();

        if (strcmp(action, "BACKUP") == 0) {
            complete(CMD_SUCCESS, "Backup completed", 100);
        } else if (strcmp(action, "INSTALL") == 0) {
            complete(CMD_SUCCESS, "Install completed", 100);
        } else if (strcmp(action, "REMOVE") == 0) {
            complete(CMD_SUCCESS, "Remove completed", 100);
        }
    }

    void handleEnvironmentMarker(const char* line) {
        if (!pending.active || pending.type != OP_ENV) {
            return;
        }

        markProtocolResponse();

        if (strcmp(line, SERIAL_PROTO_ENV_LINUX) == 0) {
            hostEnvironment = HOST_LINUX;
            complete(CMD_SUCCESS, "Linux helper ready", 100);
            return;
        }

        if (strcmp(line, SERIAL_PROTO_ENV_WINDOWS) == 0) {
            hostEnvironment = HOST_WINDOWS;
            complete(CMD_SUCCESS, "Windows detected; deploy disabled", 100);
        }
    }

    void handleErrMarker(const char* payload) {
        char action[16];
        char detail[32];
        parseMarkerPayload(payload, action, sizeof(action), detail, sizeof(detail));

        if (strcmp(action, "ENV") == 0) {
            if (pending.type != OP_ENV) {
                return;
            }

            markProtocolResponse();
            hostEnvironment = HOST_UNKNOWN;
            if (detail[0] != '\0') {
                setLastMessagef("ENV failed: %s", detail);
            } else {
                setLastMessage("Host helper error");
            }
            complete(CMD_FAIL, nullptr, 0);
            return;
        }

        if (!actionMatchesPending(action)) {
            return;
        }

        markProtocolResponse();

        if (detail[0] != '\0') {
            setLastMessagef("%s failed: %s", action, detail);
        } else {
            setLastMessagef("%s failed", action);
        }

        complete(CMD_FAIL, nullptr, pending.progress);
    }

    void handleLine(const char* line) {
        if (!line || !*line) {
            return;
        }

        DEBUG_PRINTF("[Deploy][RX] %s\n", line);

        if (strncmp(line, "AG:ENV:", 7) == 0) {
            handleEnvironmentMarker(line);
            return;
        }

        if (strncmp(line, SERIAL_PROTO_BEGIN_PREFIX, strlen(SERIAL_PROTO_BEGIN_PREFIX)) == 0) {
            handleBeginMarker(line + strlen(SERIAL_PROTO_BEGIN_PREFIX));
            return;
        }

        if (strncmp(line, SERIAL_PROTO_STEP_PREFIX, strlen(SERIAL_PROTO_STEP_PREFIX)) == 0) {
            handleStepMarker(line + strlen(SERIAL_PROTO_STEP_PREFIX));
            return;
        }

        if (strncmp(line, SERIAL_PROTO_OK_PREFIX, strlen(SERIAL_PROTO_OK_PREFIX)) == 0) {
            handleOkMarker(line + strlen(SERIAL_PROTO_OK_PREFIX));
            return;
        }

        if (strncmp(line, SERIAL_PROTO_ERR_PREFIX, strlen(SERIAL_PROTO_ERR_PREFIX)) == 0) {
            handleErrMarker(line + strlen(SERIAL_PROTO_ERR_PREFIX));
        }
    }

    void flushLineBuffer() {
        if (!pending.active || pending.lineLen == 0) {
            pending.lineLen = 0;
            pending.lineOverflow = false;
            return;
        }

        char line[SERIAL_LINE_BUFFER_SIZE];
        size_t copyLen = min(pending.lineLen, sizeof(line) - 1);
        memcpy(line, lineBuffer, copyLen);
        line[copyLen] = '\0';

        pending.lineLen = 0;
        pending.lineOverflow = false;
        handleLine(line);
    }

    void pushByte(char value) {
        if (!pending.active) {
            return;
        }

        if (value == '\r') {
            return;
        }

        if (value == '\n') {
            flushLineBuffer();
            return;
        }

        if (pending.lineLen < SERIAL_LINE_BUFFER_SIZE - 1) {
            lineBuffer[pending.lineLen++] = value;
            lineBuffer[pending.lineLen] = '\0';
        } else {
            pending.lineOverflow = true;
        }
    }

public:
    void init() {
        TARGET_SERIAL.begin(TARGET_BAUD, SERIAL_8N1, TARGET_RX_PIN, TARGET_TX_PIN);
        hostEnvironment = HOST_UNKNOWN;
        lastMessage[0] = '\0';
        lastStatus = CMD_FAIL;
        completionPending = false;
        resetPending();

        // Initialize SPIFFS and restore bundle state
        initSPIFFS();
        restoreBundleState();

        DEBUG_PRINTLN("[Deploy] Serial2 Init OK");
    }

    void update() {
        while (TARGET_SERIAL.available()) {
            pushByte(static_cast<char>(TARGET_SERIAL.read()));
        }

        if (!pending.active) {
            return;
        }

        const uint32_t now = millis();
        if (now - pending.startedAt < pending.timeoutMs) {
            return;
        }

        if (!pending.sawProtocolResponse) {
            if (pending.type == OP_ENV) {
                hostEnvironment = HOST_UNKNOWN;
                complete(CMD_FAIL, HOST_HELPER_NOT_READY_MSG, 0);
            } else {
                complete(CMD_FAIL, HOST_HELPER_NOT_READY_MSG, pending.progress);
            }
            return;
        }

        complete(CMD_FAIL, HOST_HELPER_TIMEOUT_MSG, pending.progress);
    }

    bool startEnvironmentCheck() {
        if (pending.active) {
            return false;
        }

        hostEnvironment = HOST_UNKNOWN;
        return startRequest(OP_ENV, ENV_CHECK_TIMEOUT_MS, 25, "Checking host helper");
    }

    bool startBackup() {
        if (hostEnvironment != HOST_LINUX) {
            setLastMessage("Backup supported on Linux hosts only");
            return false;
        }

        return startActionRequest(OP_BACKUP, BACKUP_TIMEOUT_MS, 5);
    }

    bool startInstall() {
        if (hostEnvironment != HOST_LINUX) {
            setLastMessage("Install supported on Linux hosts only");
            return false;
        }

        return startActionRequest(OP_INSTALL, INSTALL_TIMEOUT_MS, 10);
    }

    bool startUninstall() {
        if (hostEnvironment != HOST_LINUX) {
            setLastMessage("Remove supported on Linux hosts only");
            return false;
        }

        return startActionRequest(OP_REMOVE, REMOVE_TIMEOUT_MS, 10);
    }

    bool consumeResult(CmdStatus& outStatus) {
        if (!completionPending) {
            return false;
        }

        outStatus = lastStatus;
        completionPending = false;
        return true;
    }

    bool isBusy() const {
        return pending.active;
    }

    int getProgress() const {
        return pending.progress;
    }

    HostEnvironment getHostEnvironment() const {
        return hostEnvironment;
    }

    bool supportsDeployment() const {
        return hostEnvironment == HOST_LINUX;
    }

    const char* getLastMessage() const {
        return lastMessage;
    }

    // ============================================================
    // SPIFFS-backed deploy bundle (offline deployment)
    // ============================================================
public:
    enum BundleState {
        BUNDLE_NONE,         // No cached bundle
        BUNDLE_RECEIVED,     // Bundle written to SPIFFS, ready to deploy
        BUNDLE_DEPLOYING,    // Playing bundle to target host
        BUNDLE_DONE,         // Deploy succeeded
        BUNDLE_FAILED        // Deploy failed
    };

private:
    BundleState bundleState = BUNDLE_NONE;
    char bundlePath[DEPLOY_FILE_NAME_MAX] = "";
    uint32_t bundleSize = 0;
    uint32_t bundleReceived = 0;
    uint32_t bundlePlayed = 0;
    uint32_t bundleWriteStartedAt = 0;
    uint32_t bundleDeployStartedAt = 0;
    char bundleError[64] = "";

    bool spiffsMounted = false;
    File bundlePlayFile;  // File handle for non-blocking deploy

public:
    bool initSPIFFS() {
        if (spiffsMounted) return true;
        if (!SPIFFS.begin(true)) {
            DEBUG_PRINTLN("[Deploy] SPIFFS mount failed");
            return false;
        }
        spiffsMounted = true;
        DEBUG_PRINTLN("[Deploy] SPIFFS mounted");
        return true;
    }

    void restoreBundleState() {
        if (!spiffsMounted) return;

        // Scan SPIFFS for existing bundle files
        File root = SPIFFS.open(SPIFFS_MOUNT_POINT);
        if (!root || !root.isDirectory()) {
            DEBUG_PRINTLN("[Bundle] No deploy directory found");
            return;
        }

        File f = root.openNextFile();
        while (f) {
            if (!f.isDirectory()) {
                // Found a file, restore as cached bundle
                strncpy(bundlePath, f.path(), sizeof(bundlePath) - 1);
                bundleSize = f.size();
                bundleReceived = bundleSize;
                bundleState = BUNDLE_RECEIVED;
                DEBUG_PRINTF("[Bundle] Restored: %s (%u bytes)\n", bundlePath, bundleSize);
                f.close();
                return;
            }
            f = root.openNextFile();
        }
        DEBUG_PRINTLN("[Bundle] No cached bundle found");
    }

    bool hasBundle() const {
        return bundleState == BUNDLE_RECEIVED;
    }

    BundleState getBundleState() const {
        return bundleState;
    }

    uint32_t getBundleTotalSize() const {
        return bundleSize;
    }

    uint32_t getBundleReceived() const {
        return bundleReceived;
    }

    const char* getBundleError() const {
        return bundleError;
    }

    void clearBundle() {
        if (bundlePath[0] != '\0' && spiffsMounted) {
            SPIFFS.remove(bundlePath);
        }
        bundleState = BUNDLE_NONE;
        bundleSize = 0;
        bundleReceived = 0;
        bundlePlayed = 0;
        bundlePath[0] = '\0';
        bundleError[0] = '\0';
        DEBUG_PRINTLN("[Bundle] Cleared");
    }

    // --- Write bundle from console via Serial (USB) ---
    // Console sends:  AG:REQ:WRITE_BUNDLE:<total_size>:<filename>
    // ESP32 replies: AG:ACK:WRITE_BUNDLE:READY
    // Console sends:  AG:CHUNK:<base64_data>\n   (1KB chunks)
    // ESP32 replies: AG:ACK:CHUNK:<received_bytes>
    // Console sends:  AG:END_BUNDLE
    // ESP32 replies: AG:ACK:BUNDLE:<total_bytes>
    // Or on error:  AG:ERR:BUNDLE:<detail>

    void handleWriteBundleRequest(const char* payload) {
        if (bundleState == BUNDLE_DEPLOYING) {
            TARGET_SERIAL.println("AG:ERR:BUNDLE:deploying");
            return;
        }

        // Parse total_size:filename
        char sizeStr[16] = "";
        const char* colon1 = strchr(payload, ':');
        if (!colon1) {
            TARGET_SERIAL.println("AG:ERR:BUNDLE:missing_size");
            return;
        }
        size_t len = min(static_cast<size_t>(colon1 - payload), sizeof(sizeStr) - 1);
        memcpy(sizeStr, payload, len);
        sizeStr[len] = '\0';
        uint32_t totalSize = strtoul(sizeStr, nullptr, 10);

        const char* fname = colon1 + 1;
        if (!*fname) fname = "bundle.sh";

        if (totalSize > DEPLOY_BUNDLE_MAX_SIZE) {
            TARGET_SERIAL.println("AG:ERR:BUNDLE:too_large");
            return;
        }

        if (!initSPIFFS()) {
            TARGET_SERIAL.println("AG:ERR:BUNDLE:spiffs_fail");
            return;
        }

        // Remove old bundle
        if (bundlePath[0] != '\0') {
            SPIFFS.remove(bundlePath);
        }

        snprintf(bundlePath, sizeof(bundlePath), "%s/%s", SPIFFS_MOUNT_POINT, fname);
        bundleSize = totalSize;
        bundleReceived = 0;
        bundlePlayed = 0;
        bundleWriteStartedAt = millis();
        bundleState = BUNDLE_NONE;
        bundleError[0] = '\0';

        TARGET_SERIAL.print("AG:ACK:WRITE_BUNDLE:READY");
        DEBUG_PRINTF("[Bundle] Expecting %u bytes to %s\n", totalSize, bundlePath);
    }

    // Decode base64 chunk and append to SPIFFS file
    void handleChunk(const char* base64Data) {
        if (bundleState != BUNDLE_NONE || bundleWriteStartedAt == 0) {
            // Not in write mode
            return;
        }

        bundleState = BUNDLE_NONE; // still writing

        // Simple base64 decode (limited subset for binary safety)
        size_t b64Len = strlen(base64Data);
        if (b64Len == 0) {
            // Empty chunk = end signal handled elsewhere
            return;
        }

        // Decode base64 to a temp buffer
        uint8_t decodeBuf[RECEIVE_CHUNK_SIZE + 4];
        int decodedLen = 0;

        // Minimal base64 decode
        static const char b64table[256] = { ['A']=0,['B']=1,['C']=2,['D']=3,['E']=4,['F']=5,['G']=6,['H']=7,
            ['I']=8,['J']=9,['K']=10,['L']=11,['M']=12,['N']=13,['O']=14,['P']=15,
            ['Q']=16,['R']=17,['S']=18,['T']=19,['U']=20,['V']=21,['W']=22,['X']=23,
            ['Y']=24,['Z']=25,['a']=26,['b']=27,['c']=28,['d']=29,['e']=30,['f']=31,
            ['g']=32,['h']=33,['i']=34,['j']=35,['k']=36,['l']=37,['m']=38,['n']=39,
            ['o']=40,['p']=41,['q']=42,['r']=43,['s']=44,['t']=45,['u']=46,['v']=47,
            ['w']=48,['x']=49,['y']=50,['z']=51,['0']=52,['1']=53,['2']=54,['3']=55,
            ['4']=56,['5']=57,['6']=58,['7']=59,['8']=60,['9']=61,['+']=62,['/']=63 };

        // Quick decode (no padding check for speed)
        uint32_t accum = 0;
        int bits = 0;
        for (size_t i = 0; i < b64Len && decodedLen < RECEIVE_CHUNK_SIZE; i++) {
            uint8_t c = base64Data[i];
            uint8_t val = (c < 128) ? b64table[c] : 0xFF;
            if (val == 0xFF) continue;
            accum = (accum << 6) | val;
            bits += 6;
            if (bits >= 8) {
                decodeBuf[decodedLen++] = (accum >> (bits -8)) & 0xFF;
                bits -= 8;
            }
        }

        // Append to SPIFFS file
        File f = SPIFFS.open(bundlePath, "a");  // append mode
        if (!f) {
            snprintf(bundleError, sizeof(bundleError), "open failed: %s", bundlePath);
            TARGET_SERIAL.println("AG:ERR:BUNDLE:write_fail");
            bundleState = BUNDLE_FAILED;
            return;
        }
        size_t written = f.write(decodeBuf, decodedLen);
        f.close();

        bundleReceived += written;

        // Check timeout
        if (millis() - bundleWriteStartedAt > DEPLOY_WRITE_TIMEOUT_MS) {
            snprintf(bundleError, sizeof(bundleError), "timeout at %u/%u", bundleReceived, bundleSize);
            TARGET_SERIAL.println("AG:ERR:BUNDLE:timeout");
            bundleState = BUNDLE_FAILED;
            SPIFFS.remove(bundlePath);
            return;
        }

        char ack[64];
        snprintf(ack, sizeof(ack), "AG:ACK:CHUNK:%u", bundleReceived);
        TARGET_SERIAL.println(ack);
    }

    void handleEndBundle() {
        if (bundleReceived < bundleSize) {
            snprintf(bundleError, sizeof(bundleError), "short: %u/%u", bundleReceived, bundleSize);
            TARGET_SERIAL.println("AG:ERR:BUNDLE:short");
            bundleState = BUNDLE_FAILED;
            return;
        }

        bundleState = BUNDLE_RECEIVED;
        bundleError[0] = '\0';

        char ack[64];
        snprintf(ack, sizeof(ack), "AG:ACK:BUNDLE:%u", bundleReceived);
        TARGET_SERIAL.println(ack);
        DEBUG_PRINTF("[Bundle] Received complete: %u bytes\n", bundleReceived);
    }

    // --- Status query from console ---
    void handleStatusRequest() {
        switch (bundleState) {
            case BUNDLE_NONE:
                TARGET_SERIAL.println("AG:STATUS:NO_BUNDLE");
                break;
            case BUNDLE_RECEIVED:
                TARGET_SERIAL.print("AG:STATUS:BUNDLE_READY:");
                TARGET_SERIAL.println(bundlePath);
                break;
            case BUNDLE_DEPLOYING:
                TARGET_SERIAL.print("AG:STATUS:DEPLOYING:");
                TARGET_SERIAL.println(bundlePath);
                break;
            case BUNDLE_DONE:
                TARGET_SERIAL.println("AG:STATUS:DEPLOY_OK");
                break;
            case BUNDLE_FAILED:
                TARGET_SERIAL.print("AG:STATUS:DEPLOY_ERR:");
                TARGET_SERIAL.println(bundleError);
                break;
        }
    }

    // --- Deploy: play bundle from SPIFFS to target host via serial (non-blocking) ---
    void startDeploy() {
        if (bundleState != BUNDLE_RECEIVED) {
            TARGET_SERIAL.println("AG:ERR:DEPLOY:no_bundle");
            return;
        }

        bundlePlayFile = SPIFFS.open(bundlePath, "r");
        if (!bundlePlayFile) {
            snprintf(bundleError, sizeof(bundleError), "file missing: %s", bundlePath);
            TARGET_SERIAL.println("AG:ERR:DEPLOY:file_missing");
            bundleState = BUNDLE_FAILED;
            return;
        }

        bundleState = BUNDLE_DEPLOYING;
        bundleDeployStartedAt = millis();
        bundlePlayed = 0;

        TARGET_SERIAL.println("AG:BEGIN:DEPLOY");
        DEBUG_PRINTLN("[Bundle] Starting non-blocking deploy");
    }

    // Call this from loop() when bundleState == BUNDLE_DEPLOYING
    void updateBundleDeploy() {
        if (bundleState != BUNDLE_DEPLOYING || !bundlePlayFile) return;

        // Check timeout
        if (millis() - bundleDeployStartedAt > DEPLOY_PLAY_TIMEOUT_MS) {
            TARGET_SERIAL.println("AG:ERR:DEPLOY:timeout");
            bundleState = BUNDLE_FAILED;
            bundlePlayFile.close();
            snprintf(bundleError, sizeof(bundleError), "timeout at %u/%u", bundlePlayed, bundleSize);
            return;
        }

        // Read and send one chunk per update
        uint8_t readBuf[RECEIVE_CHUNK_SIZE];
        int bytes = bundlePlayFile.read(readBuf, sizeof(readBuf));
        if (bytes <= 0) {
            // EOF or error - deploy complete
            bundlePlayFile.close();
            bundleState = BUNDLE_DONE;
            TARGET_SERIAL.println("AG:OK:DEPLOY");
            DEBUG_PRINTF("[Bundle] Deploy complete: %u bytes\n", bundlePlayed);
            return;
        }

        // Write hex-encoded data to target serial
        TARGET_SERIAL.print("AG:DATA:");
        for (int i = 0; i < bytes; i++) {
            TARGET_SERIAL.printf("%02X", readBuf[i]);
        }
        TARGET_SERIAL.println();

        bundlePlayed += bytes;

        // Progress report
        if (bundleSize > 0) {
            int pct = (bundlePlayed * 100) / bundleSize;
            char progress[64];
            snprintf(progress, sizeof(progress), "AG:PROGRESS:DEPLOY:%d", pct);
            TARGET_SERIAL.println(progress);
        }
    }

    uint32_t getBundlePlayed() const {
        return bundlePlayed;
    }

    int getBundleDeployProgress() const {
        if (bundleSize == 0) return 0;
        return (bundlePlayed * 100) / bundleSize;
    }

    // --- Handle bundle-related serial input from Console ---
    void handleBundleSerialLine(const char* line) {
        if (strncmp(line, "AG:REQ:WRITE_BUNDLE:") == 0) {
            handleWriteBundleRequest(line + strlen("AG:REQ:WRITE_BUNDLE:"));
        } else if (strncmp(line, "AG:CHUNK:") == 0) {
            handleChunk(line + strlen("AG:CHUNK:"));
        } else if (strcmp(line, "AG:END_BUNDLE") == 0) {
            handleEndBundle();
        } else if (strcmp(line, "AG:REQ:STATUS") == 0) {
            handleStatusRequest();
        } else if (strcmp(line, "AG:REQ:DEPLOY") == 0) {
            startDeploy();
        } else if (strcmp(line, "AG:REQ:CLEAR_BUNDLE") == 0) {
            // Clear stored bundle
            if (bundlePath[0] != '\0') {
                SPIFFS.remove(bundlePath);
            }
            bundleState = BUNDLE_NONE;
            bundleSize = 0;
            bundleReceived = 0;
            bundlePlayed = 0;
            bundlePath[0] = '\0';
            bundleError[0] = '\0';
            TARGET_SERIAL.println("AG:ACK:CLEAR_BUNDLE");
            DEBUG_PRINTLN("[Bundle] Cleared");
        }
    }

    // Integrate into existing update() — process bundle commands on Serial0 (console)
    // Also handles non-blocking bundle deploy
    void updateBundle() {
        // Handle non-blocking bundle deploy first
        updateBundleDeploy();

        // Only process Serial0 if not busy with deployment-to-host
        if (pending.active) return;

        while (Serial.available()) {
            char c = Serial.read();
            // Accumulate line
            if (c == '\n') {
                // Process completed line
                if (pending.lineLen > 0) {
                    pending.lineBuffer[pending.lineLen] = '\0';
                    handleBundleSerialLine(pending.lineBuffer);
                    pending.lineLen = 0;
                }
            } else if (c == '\r') {
                // flush
                if (pending.lineLen > 0) {
                    pending.lineBuffer[pending.lineLen] = '\0';
                    handleBundleSerialLine(pending.lineBuffer);
                    pending.lineLen = 0;
                }
            } else {
                if (pending.lineLen < SERIAL_LINE_BUFFER_SIZE - 1) {
                    pending.lineBuffer[pending.lineLen++] = c;
                }
            }
        }
    }
};

#endif // DEPLOYMENT_H
