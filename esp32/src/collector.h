/**
 * AetherGuard ESP32 - 优化版系统信息采集模块
 * 
 * 优化策略：
 * - 使用 __packed 结构体减少内存对齐开销
 * - 避免 String 类使用 (防止堆碎片)
 * - 使用静态缓冲区
 * - 增量式数据采集 (避免一次性大内存分配)
 *
 * NOTE: Experimental cloud-device module. It is not compiled by the active
 * serial-deployer PlatformIO target.
 */

#ifndef COLLECTOR_H
#define COLLECTOR_H

#include <Arduino.h>
#include "config.h"

// 紧凑的系统信息结构 (使用 __packed 减少内存)
struct __attribute__((packed)) SystemInfoCompact {
    // 基本信息 (使用枚举代替字符串)
    uint8_t osType;         // 0=unknown, 1=linux, 2=windows, 3=freertos
    uint8_t archType;       // 0=unknown, 1=x86, 2=x64, 3=arm, 4=xtensa
    
    // 资源使用 (百分比，0-100)
    uint8_t cpuUsage;
    uint8_t memUsage;
    uint8_t diskUsage;
    
    // 核心数据 (16位足够)
    uint16_t processCount;
    uint16_t connectionCount;
    uint16_t listeningPorts;
    
    // 网络流量 (压缩: 以 KB 为单位)
    uint16_t bytesInKB;
    uint16_t bytesOutKB;
    
    // 时间戳 (相对于启动时间)
    uint32_t relativeTime;
};

// OS 类型枚举
enum OSType : uint8_t {
    OS_UNKNOWN = 0,
    OS_LINUX = 1,
    OS_WINDOWS = 2,
    OS_FREERTOS = 3,
    OS_MACOS = 4
};

// 架构类型枚举
enum ArchType : uint8_t {
    ARCH_UNKNOWN = 0,
    ARCH_X86 = 1,
    ARCH_X64 = 2,
    ARCH_ARM32 = 3,
    ARCH_ARM64 = 4,
    ARCH_XTENSA = 5,
    ARCH_RISCV = 6
};

class Collector {
private:
    HardwareSerial* targetSerial;
    SystemInfoCompact lastInfo;
    
    // 静态接收缓冲区
    char rxBuffer[RX_BUFFER_SIZE];
    
    /**
     * 发送命令并接收响应 (优化版)
     */
    uint16_t sendCommand(const char* cmd, char* response, uint16_t maxLen) {
        if (!targetSerial) return 0;
        
        // 清空接收缓冲区
        while (targetSerial->available()) {
            targetSerial->read();
        }
        
        // 发送命令
        targetSerial->println(cmd);
        
        // 等待响应 (带超时)
        uint16_t received = 0;
        uint32_t startTime = millis();
        const uint32_t timeout = 1000;  // 1秒超时 (减少等待)
        
        while (millis() - startTime < timeout && received < maxLen - 1) {
            if (targetSerial->available()) {
                response[received++] = targetSerial->read();
                startTime = millis();  // 重置超时
            } else {
                delayMicroseconds(100);  // 微秒级休眠
            }
        }
        
        response[received] = '\0';
        return received;
    }
    
    /**
     * 解析紧凑格式响应
     * 格式: "L,x64,45,62,38,156,24,3,102,85"
     *       OS,ARCH,CPU%,MEM%,DISK%,PROC,CONN,PORT,IN_KB,OUT_KB
     */
    bool parseCompactResponse(const char* data) {
        if (!data || data[0] == '\0') return false;
        
        // 使用 sscanf 快速解析 (比 JSON 解析器快 10x)
        char osChar, archStr[8];
        int cpu, mem, disk, proc, conn, port, inKB, outKB;
        
        int parsed = sscanf(data, "%c,%7[^,],%d,%d,%d,%d,%d,%d,%d,%d",
            &osChar, archStr, &cpu, &mem, &disk, 
            &proc, &conn, &port, &inKB, &outKB);
        
        if (parsed < 10) return false;
        
        // 映射 OS 类型
        switch (osChar) {
            case 'L': lastInfo.osType = OS_LINUX; break;
            case 'W': lastInfo.osType = OS_WINDOWS; break;
            case 'F': lastInfo.osType = OS_FREERTOS; break;
            case 'M': lastInfo.osType = OS_MACOS; break;
            default:  lastInfo.osType = OS_UNKNOWN; break;
        }
        
        // 映射架构
        if (strcmp(archStr, "x64") == 0) lastInfo.archType = ARCH_X64;
        else if (strcmp(archStr, "x86") == 0) lastInfo.archType = ARCH_X86;
        else if (strcmp(archStr, "arm") == 0) lastInfo.archType = ARCH_ARM32;
        else if (strcmp(archStr, "arm64") == 0) lastInfo.archType = ARCH_ARM64;
        else if (strcmp(archStr, "xtensa") == 0) lastInfo.archType = ARCH_XTENSA;
        else lastInfo.archType = ARCH_UNKNOWN;
        
        // 存储数值 (已经是压缩格式)
        lastInfo.cpuUsage = (uint8_t)constrain(cpu, 0, 100);
        lastInfo.memUsage = (uint8_t)constrain(mem, 0, 100);
        lastInfo.diskUsage = (uint8_t)constrain(disk, 0, 100);
        lastInfo.processCount = (uint16_t)proc;
        lastInfo.connectionCount = (uint16_t)conn;
        lastInfo.listeningPorts = (uint16_t)port;
        lastInfo.bytesInKB = (uint16_t)inKB;
        lastInfo.bytesOutKB = (uint16_t)outKB;
        lastInfo.relativeTime = millis() / 1000;
        
        return true;
    }

public:
    void init() {
        Serial2.begin(115200, SERIAL_8N1, SERIAL_RX_PIN, SERIAL_TX_PIN);
        targetSerial = &Serial2;
        memset(&lastInfo, 0, sizeof(lastInfo));
        DEBUG_PRINTLN("[Collector] Init OK");
    }
    
    /**
     * 采集系统信息 (返回二进制格式)
     */
    const SystemInfoCompact* collect() {
        uint16_t len = sendCommand("C", rxBuffer, RX_BUFFER_SIZE);
        
        if (len > 0) {
            parseCompactResponse(rxBuffer);
        }
        
        return &lastInfo;
    }
    
    /**
     * 序列化为紧凑 JSON (最小化大小)
     * 输出: {"d":"ESP32-001","t":12345,"s":{"c":45,"m":62,"p":156}}
     */
    uint16_t toCompactJson(char* output, uint16_t maxLen) {
        return snprintf(output, maxLen,
            "{\"d\":\"%s\",\"t\":%lu,\"o\":%d,\"a\":%d,"
            "\"s\":{\"c\":%d,\"m\":%d,\"k\":%d,\"p\":%d,\"n\":%d,\"l\":%d}}",
            DEVICE_ID,
            lastInfo.relativeTime,
            lastInfo.osType,
            lastInfo.archType,
            lastInfo.cpuUsage,
            lastInfo.memUsage,
            lastInfo.diskUsage,
            lastInfo.processCount,
            lastInfo.connectionCount,
            lastInfo.listeningPorts
        );
    }
    
    /**
     * 序列化为二进制格式 (最紧凑)
     * 直接发送结构体字节
     */
    uint16_t toBinary(uint8_t* output) {
        memcpy(output, &lastInfo, sizeof(SystemInfoCompact));
        return sizeof(SystemInfoCompact);
    }
    
    // 访问器
    uint8_t getCpuUsage() const { return lastInfo.cpuUsage; }
    uint8_t getMemUsage() const { return lastInfo.memUsage; }
    uint16_t getProcessCount() const { return lastInfo.processCount; }
};

#endif // COLLECTOR_H
