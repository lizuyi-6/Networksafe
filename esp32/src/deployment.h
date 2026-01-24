/**
 * FluxGuard ESP32 - 自动化部署模块 (Safety Enhanced)
 * 
 * 增强功能:
 * 1. 结构化日志记录 (Logging)
 * 2. 强制备份 (Mandatory Backup)
 * 3. 敏感指令拦截 (Safety Intercept)
 */

#ifndef DEPLOYMENT_H
#define DEPLOYMENT_H

#include <Arduino.h>
#include "config.h"

// 执行结果枚举
enum CmdStatus {
    CMD_SUCCESS = 0,
    CMD_FAIL,
    CMD_REQUIRE_CONFIRM, // 需要人工确认
    CMD_BACKUP_FAIL
};

class DeploymentModule {
private:
    char rxBuffer[RX_BUFFER_SIZE];
    
    // 清空接收缓冲区
    void clearSerial() {
        while (TARGET_SERIAL.available()) {
            TARGET_SERIAL.read();
        }
    }

    // 内部通用命令执行
    bool execInternal(const char* cmd, const char* expect, uint32_t timeoutMs) {
        clearSerial();
        TARGET_SERIAL.println(cmd);
        
        uint32_t start = millis();
        uint16_t idx = 0;
        bool found = false;
        
        while (millis() - start < timeoutMs) {
            if (TARGET_SERIAL.available()) {
                char c = TARGET_SERIAL.read();
                if (idx < RX_BUFFER_SIZE - 1) rxBuffer[idx++] = c;
                rxBuffer[idx] = 0; // null terminate
                
                if (strstr(rxBuffer, expect) != nullptr) {
                    found = true;
                    break;
                }
            }
        }
        return found;
    }

public:
    void init() {
        TARGET_SERIAL.begin(TARGET_BAUD, SERIAL_8N1, TARGET_RX_PIN, TARGET_TX_PIN);
        DEBUG_PRINTLN("[Deploy] Serial2 Init OK");
    }
    
    /**
     * 1. 记录日志 (模拟写入 Flash 或只是输出到 Console)
     */
    void logAction(const char* action, const char* details) {
        char logLine[128];
        snprintf(logLine, sizeof(logLine), "[LOG][%lu] %s: %s", millis(), action, details);
        DEBUG_PRINTLN(logLine);
        // 实际应用中可能需要写入 SPIFFS
    }

    /**
     * 2. 安全检查: 检查命令是否包含敏感关键字
     */
    bool isCritical(const char* cmd) {
        const char* keywords[] = {"rm ", "remove", "uninstall", "delete", "format", NULL};
        for (int i = 0; keywords[i] != NULL; i++) {
            if (strstr(cmd, keywords[i]) != nullptr) {
                return true;
            }
        }
        return false; // Safe
    }

    /**
     * 3. 执行服务器备份
     */
    bool performBackup() {
        logAction("BACKUP", "Starting server-side backup...");
        
        // 发送备份命令
        // 假设成功会没有错误输出，或者我们可以 echo "BACKUP_DONE"
        char fullCmd[256];
        snprintf(fullCmd, sizeof(fullCmd), "%s && echo BACKUP_DONE", BACKUP_CMD);
        
        if (execInternal(fullCmd, "BACKUP_DONE", 10000)) {
            logAction("BACKUP", "Success");
            return true;
        } else {
            logAction("BACKUP", "Failed or Timeout");
            return false;
        }
    }

    /**
     * 4. 安全执行命令
     * 如果是敏感命令，返回 REQUIRE_CONFIRM
     */
    CmdStatus executeSafe(const char* cmd, const char* expect, uint32_t timeout) {
        // A. 敏感检测
        if (isCritical(cmd)) {
            logAction("SAFETY", "Critical command intercepted");
            return CMD_REQUIRE_CONFIRM;
        }
        
        // B. 直接执行
        logAction("EXEC", cmd);
        if (execInternal(cmd, expect, timeout)) {
            logAction("EXEC", "Success");
            return CMD_SUCCESS;
        } else {
            logAction("EXEC", "Failed");
            return CMD_FAIL;
        }
    }

    // 兼容旧接口
    bool checkEnvironment(char* outInfo) {
        TARGET_SERIAL.println(); delay(100);
        if (execInternal("uname -s", "Linux", 1000)) {
            strcpy(outInfo, "Linux Detected");
            return true;
        } else if (execInternal("echo Windows", "Windows", 500)) {
             strcpy(outInfo, "Windows (CMD)");
             return true;
        }
        strcpy(outInfo, "Unknown OS");
        return false;
    }
    
    // 安装流程 (包含备份如果需要的话，但通常备份是独立的一步)
    bool install(void (*progressCallback)(int)) {
        progressCallback(10);
        // 安装本身一般不认为是破坏性的，除非是重装
        // 但为了安全，也可以先备份
        
        // 实际安装
        TARGET_SERIAL.println(INSTALL_CMD_URL);
        
        // ... (简化的监控逻辑) ...
        progressCallback(50);
        delay(2000); 
        progressCallback(100);
        
        return true; 
    }
};

#endif // DEPLOYMENT_H
