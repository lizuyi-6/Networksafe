/**
 * FluxGuard ESP32 - 优化版密码本模块
 * 
 * 优化策略：
 * - 使用固定大小数组替代 std::map (节省 ~8KB RAM)
 * - 二分查找替代哈希表 (节省内存，可接受性能)
 * - 存储在 PROGMEM (Flash) 减少 RAM 占用
 */

#ifndef CODEBOOK_H
#define CODEBOOK_H

#include <Arduino.h>
#include "config.h"

// 预定义错误码结构 (存储在 Flash)
struct CodeEntry {
    char code[6];       // 如 "E001"
    char message[48];   // 简短消息
};

// 默认密码本 (存储在 Flash, 不占用 RAM)
static const CodeEntry PROGMEM DEFAULT_CODEBOOK[] = {
    // 系统错误 (E0xx)
    {"E001", "Connection refused"},
    {"E002", "Permission denied"},
    {"E003", "Out of memory"},
    {"E004", "Disk full"},
    {"E005", "Service unavailable"},
    {"E006", "Auth failed"},
    {"E007", "Timeout"},
    {"E008", "Network unreachable"},
    
    // 状态码 (S0xx)
    {"S001", "CPU critical"},
    {"S002", "Memory critical"},
    {"S003", "Disk critical"},
    {"S004", "High load"},
    
    // 安全告警 (A0xx)
    {"A001", "SQLi detected"},
    {"A002", "XSS blocked"},
    {"A003", "Path traversal"},
    {"A004", "Cmd injection"},
    {"A005", "Brute force"},
    {"A006", "DDoS pattern"},
    {"A007", "Malicious bot"},
    {"A008", "Suspicious proc"},
};

#define DEFAULT_CODEBOOK_SIZE (sizeof(DEFAULT_CODEBOOK) / sizeof(CodeEntry))

class Codebook {
private:
    // 动态条目 (远程同步的)
    CodeEntry dynamicEntries[16];   // 最多 16 个动态条目
    uint8_t dynamicCount;
    
    // 二分查找默认密码本
    int16_t findInDefault(const char* code) {
        int16_t left = 0;
        int16_t right = DEFAULT_CODEBOOK_SIZE - 1;
        
        while (left <= right) {
            int16_t mid = (left + right) >> 1;
            
            // 从 PROGMEM 读取
            char entryCode[6];
            memcpy_P(entryCode, DEFAULT_CODEBOOK[mid].code, 6);
            
            int cmp = strcmp(code, entryCode);
            if (cmp == 0) return mid;
            if (cmp < 0) right = mid - 1;
            else left = mid + 1;
        }
        return -1;
    }
    
    // 线性查找动态条目
    int16_t findInDynamic(const char* code) {
        for (uint8_t i = 0; i < dynamicCount; i++) {
            if (strcmp(code, dynamicEntries[i].code) == 0) {
                return i;
            }
        }
        return -1;
    }

public:
    void init() {
        dynamicCount = 0;
        DEBUG_PRINTF("[Codebook] %d default entries\n", DEFAULT_CODEBOOK_SIZE);
    }
    
    /**
     * 查找消息 -> 编码 (用于压缩)
     * 返回: 编码字符串，或 NULL 如果未找到
     */
    const char* encode(const char* message, char* outCode) {
        // 先查默认表
        for (uint16_t i = 0; i < DEFAULT_CODEBOOK_SIZE; i++) {
            char msg[48];
            memcpy_P(msg, DEFAULT_CODEBOOK[i].message, 48);
            
            if (strcmp(message, msg) == 0) {
                memcpy_P(outCode, DEFAULT_CODEBOOK[i].code, 6);
                return outCode;
            }
        }
        
        // 再查动态表
        for (uint8_t i = 0; i < dynamicCount; i++) {
            if (strcmp(message, dynamicEntries[i].message) == 0) {
                strcpy(outCode, dynamicEntries[i].code);
                return outCode;
            }
        }
        
        return NULL;  // 未找到
    }
    
    /**
     * 查找编码 -> 消息 (用于解压)
     */
    bool decode(const char* code, char* outMessage, size_t maxLen) {
        // 先查默认表
        int16_t idx = findInDefault(code);
        if (idx >= 0) {
            memcpy_P(outMessage, DEFAULT_CODEBOOK[idx].message, min(maxLen, (size_t)48));
            return true;
        }
        
        // 再查动态表
        idx = findInDynamic(code);
        if (idx >= 0) {
            strncpy(outMessage, dynamicEntries[idx].message, maxLen);
            return true;
        }
        
        return false;
    }
    
    /**
     * 添加动态条目 (从服务器同步)
     */
    bool addEntry(const char* code, const char* message) {
        if (dynamicCount >= 16) {
            // 满了，覆盖最旧的
            memmove(&dynamicEntries[0], &dynamicEntries[1], 
                    sizeof(CodeEntry) * 15);
            dynamicCount = 15;
        }
        
        strncpy(dynamicEntries[dynamicCount].code, code, 5);
        dynamicEntries[dynamicCount].code[5] = '\0';
        strncpy(dynamicEntries[dynamicCount].message, message, 47);
        dynamicEntries[dynamicCount].message[47] = '\0';
        dynamicCount++;
        
        return true;
    }
    
    /**
     * 压缩 JSON 中的错误消息
     * 输入: {"errors":["SQL Injection detected","XSS blocked"]}
     * 输出: {"c":["A001","A002"]}
     */
    size_t compressErrors(const char* input, char* output, size_t maxLen) {
        // 简化实现：只处理特定格式
        // 实际应用中可根据需要扩展
        
        char* outPtr = output;
        const char* inPtr = input;
        size_t remaining = maxLen - 1;
        
        // 复制输入到输出 (基础实现)
        // TODO: 实现完整的 JSON 解析和压缩
        strncpy(output, input, maxLen);
        output[maxLen - 1] = '\0';
        
        return strlen(output);
    }
    
    uint8_t getCount() {
        return DEFAULT_CODEBOOK_SIZE + dynamicCount;
    }
};

#endif // CODEBOOK_H
