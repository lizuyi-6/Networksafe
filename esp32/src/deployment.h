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
};

#endif // DEPLOYMENT_H
