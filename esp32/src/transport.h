/**
 * AetherGuard ESP32 - 优化版传输层模块
 * 
 * 优化策略：
 * - 连接池复用
 * - 减少内存分配
 * - 自动重连带退避
 * - 低功耗模式支持
 *
 * NOTE: Experimental cloud-device module. It is not compiled by the active
 * serial-deployer PlatformIO target.
 */

#ifndef TRANSPORT_H
#define TRANSPORT_H

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiServer.h>
#include <WebSocketsClient.h>
#include "config.h"

// 连接状态枚举
enum ConnectionState : uint8_t {
    CONN_DISCONNECTED = 0,
    CONN_CONNECTING = 1,
    CONN_CONNECTED = 2,
    CONN_ERROR = 3
};

class Transport {
private:
    WebSocketsClient* wsClient;
    WiFiServer* localServer;
    WiFiClient localClient;
    
    ConnectionState cloudState;
    ConnectionState localState;
    
    // 重连退避
    uint32_t lastReconnectAttempt;
    uint16_t reconnectInterval;
    static const uint16_t MAX_RECONNECT_INTERVAL = 30000;
    
    // 静态发送缓冲区
    char txBuffer[TX_BUFFER_SIZE];

public:
    void init(WebSocketsClient* ws) {
        wsClient = ws;
        localServer = nullptr;
        cloudState = CONN_DISCONNECTED;
        localState = CONN_DISCONNECTED;
        lastReconnectAttempt = 0;
        reconnectInterval = 1000;
    }
    
    // ============================================
    // 离线模式: WiFi AP
    // ============================================
    bool startLocalAP() {
        WiFi.mode(WIFI_AP);
        
        if (!WiFi.softAP(WIFI_SSID, WIFI_PASSWORD)) {
            DEBUG_PRINTLN("[Transport] AP fail");
            return false;
        }
        
        if (!localServer) {
            localServer = new WiFiServer(LOCAL_PORT);
        }
        localServer->begin();
        localState = CONN_CONNECTED;
        
        DEBUG_PRINTF("[Transport] AP: %s\n", WiFi.softAPIP().toString().c_str());
        return true;
    }
    
    void stopLocalAP() {
        if (localServer) {
            localServer->stop();
        }
        WiFi.softAPdisconnect(true);
        localState = CONN_DISCONNECTED;
    }
    
    void handleLocalClients() {
        if (!localServer || localState != CONN_CONNECTED) return;
        
        if (localServer->hasClient()) {
            if (!localClient || !localClient.connected()) {
                localClient = localServer->available();
                DEBUG_PRINTLN("[Transport] Client connected");
            }
        }
    }
    
    bool sendLocal(const char* data, uint16_t len) {
        if (!localClient.connected()) return false;
        
        localClient.write((const uint8_t*)data, len);
        localClient.write('\n');
        return true;
    }
    
    // ============================================
    // 联网模式: WebSocket
    // ============================================
    bool connectCloud() {
        if (cloudState == CONN_CONNECTING) return false;
        
        // 断开 AP
        stopLocalAP();
        
        // 连接 WiFi
        WiFi.mode(WIFI_STA);
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
        
        cloudState = CONN_CONNECTING;
        uint32_t startTime = millis();
        
        while (WiFi.status() != WL_CONNECTED) {
            if (millis() - startTime > WIFI_CONNECT_TIMEOUT) {
                cloudState = CONN_ERROR;
                DEBUG_PRINTLN("[Transport] WiFi timeout");
                return false;
            }
            delay(100);
        }
        
        DEBUG_PRINTF("[Transport] WiFi OK: %s\n", WiFi.localIP().toString().c_str());
        
        // WebSocket
        #if SERVER_USE_SSL
            wsClient->beginSSL(SERVER_HOST, SERVER_PORT, SERVER_PATH);
        #else
            wsClient->begin(SERVER_HOST, SERVER_PORT, SERVER_PATH);
        #endif
        
        // 优化 WebSocket 参数
        wsClient->setReconnectInterval(reconnectInterval);
        wsClient->enableHeartbeat(15000, 3000, 2);  // 心跳优化
        
        cloudState = CONN_CONNECTED;
        reconnectInterval = 1000;  // 重置退避
        return true;
    }
    
    void disconnectCloud() {
        if (cloudState != CONN_DISCONNECTED) {
            wsClient->disconnect();
            WiFi.disconnect(true);
            cloudState = CONN_DISCONNECTED;
        }
    }
    
    /**
     * 发送数据 (自动选择模式)
     */
    bool send(const char* data, uint16_t len) {
        if (cloudState == CONN_CONNECTED) {
            return wsClient->sendTXT(data, len);
        } else if (localState == CONN_CONNECTED) {
            return sendLocal(data, len);
        }
        return false;
    }
    
    /**
     * 发送二进制数据 (更高效)
     */
    bool sendBinary(const uint8_t* data, uint16_t len) {
        if (cloudState == CONN_CONNECTED) {
            return wsClient->sendBIN(data, len);
        } else if (localState == CONN_CONNECTED && localClient.connected()) {
            localClient.write(data, len);
            return true;
        }
        return false;
    }
    
    /**
     * 发送心跳 (最小化数据)
     */
    bool sendHeartbeat() {
        if (cloudState != CONN_CONNECTED) return false;
        
        // 最小心跳: {"h":1,"u":12345,"f":180000}
        int len = snprintf(txBuffer, TX_BUFFER_SIZE,
            "{\"h\":1,\"u\":%lu,\"f\":%lu}",
            millis() / 1000,
            ESP.getFreeHeap()
        );
        
        return wsClient->sendTXT(txBuffer, len);
    }
    
    /**
     * 发送注册 (精简版)
     */
    bool sendRegistration() {
        if (cloudState != CONN_CONNECTED) return false;
        
        int len = snprintf(txBuffer, TX_BUFFER_SIZE,
            "{\"r\":1,\"d\":\"%s\",\"v\":\"%s\",\"k\":\"%s\"}",
            DEVICE_ID, DEVICE_VERSION, API_KEY
        );
        
        return wsClient->sendTXT(txBuffer, len);
    }
    
    /**
     * 自动重连 (带指数退避)
     */
    bool autoReconnect() {
        if (cloudState == CONN_CONNECTED) return true;
        if (cloudState == CONN_CONNECTING) return false;
        
        uint32_t now = millis();
        if (now - lastReconnectAttempt < reconnectInterval) {
            return false;
        }
        
        lastReconnectAttempt = now;
        bool success = connectCloud();
        
        if (!success) {
            // 指数退避
            reconnectInterval = min((uint16_t)(reconnectInterval * 2), MAX_RECONNECT_INTERVAL);
        }
        
        return success;
    }
    
    // 状态访问
    bool isCloudConnected() const { return cloudState == CONN_CONNECTED; }
    bool isLocalConnected() const { return localState == CONN_CONNECTED; }
    ConnectionState getCloudState() const { return cloudState; }
    void setCloudState(ConnectionState s) { cloudState = s; }
};

#endif // TRANSPORT_H
