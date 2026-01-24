/**
 * FluxGuard ESP32 - AI 模型调用模块
 * 
 * 支持多模型来源：
 * 1. 用户笔记本本地模型 (默认)
 * 2. 用户服务器部署的模型 (可配置)
 * 3. 服务器集群模型 (可配置)
 * 
 * 优先级: 自定义端点 > 笔记本本地
 */

#ifndef AI_MODEL_H
#define AI_MODEL_H

#include <Arduino.h>
#include <WiFiClient.h>
#include <HTTPClient.h>
#include "config.h"

// 模型端点结构
struct ModelEndpoint {
    char url[128];          // API 端点 URL
    char modelName[32];     // 模型名称
    char apiKey[64];        // API 密钥
    bool enabled;           // 是否启用
    uint16_t timeout;       // 超时时间 (ms)
};

// 模型响应结构
struct ModelResponse {
    bool success;
    char result[256];       // 分析结果
    uint8_t threatLevel;    // 威胁等级 0-10
    char action[32];        // 建议操作
};

// 最多支持 3 个自定义端点
#define MAX_CUSTOM_ENDPOINTS 3

class AIModel {
private:
    // 默认端点 (笔记本)
    ModelEndpoint defaultEndpoint;
    
    // 自定义端点列表
    ModelEndpoint customEndpoints[MAX_CUSTOM_ENDPOINTS];
    uint8_t customCount;
    
    // HTTP 客户端
    HTTPClient http;
    WiFiClient client;
    
    // 静态缓冲区
    char requestBuffer[512];
    char responseBuffer[512];
    
    /**
     * 调用单个端点
     */
    bool callEndpoint(const ModelEndpoint& endpoint, const char* data, ModelResponse& response) {
        if (!endpoint.enabled || endpoint.url[0] == '\0') {
            return false;
        }
        
        DEBUG_PRINTF("[AI] Calling: %s\n", endpoint.url);
        
        // 构建请求
        http.begin(client, endpoint.url);
        http.setTimeout(endpoint.timeout);
        http.addHeader("Content-Type", "application/json");
        
        if (endpoint.apiKey[0] != '\0') {
            http.addHeader("Authorization", String("Bearer ") + endpoint.apiKey);
        }
        
        // 构建请求体
        int reqLen = snprintf(requestBuffer, sizeof(requestBuffer),
            "{\"model\":\"%s\",\"prompt\":\"%s\",\"stream\":false}",
            endpoint.modelName[0] ? endpoint.modelName : "default",
            data
        );
        
        // 发送请求
        int httpCode = http.POST(requestBuffer);
        
        if (httpCode == HTTP_CODE_OK) {
            String payload = http.getString();
            
            // 简单解析响应 (避免完整 JSON 解析)
            // 期望格式: {"result":"...","threat":5,"action":"block"}
            
            const char* resultPtr = strstr(payload.c_str(), "\"result\":\"");
            if (resultPtr) {
                resultPtr += 10;
                const char* endPtr = strchr(resultPtr, '"');
                if (endPtr) {
                    size_t len = min((size_t)(endPtr - resultPtr), sizeof(response.result) - 1);
                    strncpy(response.result, resultPtr, len);
                    response.result[len] = '\0';
                }
            }
            
            const char* threatPtr = strstr(payload.c_str(), "\"threat\":");
            if (threatPtr) {
                response.threatLevel = atoi(threatPtr + 9);
            }
            
            const char* actionPtr = strstr(payload.c_str(), "\"action\":\"");
            if (actionPtr) {
                actionPtr += 10;
                const char* endPtr = strchr(actionPtr, '"');
                if (endPtr) {
                    size_t len = min((size_t)(endPtr - actionPtr), sizeof(response.action) - 1);
                    strncpy(response.action, actionPtr, len);
                    response.action[len] = '\0';
                }
            }
            
            response.success = true;
            http.end();
            return true;
        }
        
        DEBUG_PRINTF("[AI] HTTP error: %d\n", httpCode);
        http.end();
        return false;
    }

public:
    void init() {
        // 初始化默认端点 (笔记本)
        strcpy(defaultEndpoint.url, "http://");
        strcat(defaultEndpoint.url, LOCAL_HOST);
        strcat(defaultEndpoint.url, ":5000/api/analyze");
        strcpy(defaultEndpoint.modelName, "llama3");
        defaultEndpoint.apiKey[0] = '\0';
        defaultEndpoint.enabled = true;
        defaultEndpoint.timeout = 10000;
        
        customCount = 0;
        
        DEBUG_PRINTLN("[AI] Init OK");
    }
    
    /**
     * 配置自定义端点
     */
    bool addCustomEndpoint(const char* url, const char* model, const char* apiKey) {
        if (customCount >= MAX_CUSTOM_ENDPOINTS) {
            return false;
        }
        
        ModelEndpoint& ep = customEndpoints[customCount];
        strncpy(ep.url, url, sizeof(ep.url) - 1);
        strncpy(ep.modelName, model, sizeof(ep.modelName) - 1);
        strncpy(ep.apiKey, apiKey, sizeof(ep.apiKey) - 1);
        ep.enabled = true;
        ep.timeout = 15000;
        
        customCount++;
        
        DEBUG_PRINTF("[AI] Added endpoint: %s\n", url);
        return true;
    }
    
    /**
     * 从 JSON 配置解析端点
     * 格式: {"endpoints":[{"url":"...","model":"...","key":"..."}]}
     */
    void loadFromJson(const char* json) {
        customCount = 0;
        
        const char* ptr = json;
        while ((ptr = strstr(ptr, "\"url\":\"")) != nullptr && customCount < MAX_CUSTOM_ENDPOINTS) {
            ptr += 7;
            
            // 解析 URL
            char url[128] = {0};
            const char* end = strchr(ptr, '"');
            if (end) {
                size_t len = min((size_t)(end - ptr), sizeof(url) - 1);
                strncpy(url, ptr, len);
            }
            
            // 解析 model
            char model[32] = {0};
            const char* modelPtr = strstr(end, "\"model\":\"");
            if (modelPtr) {
                modelPtr += 9;
                const char* modelEnd = strchr(modelPtr, '"');
                if (modelEnd) {
                    size_t len = min((size_t)(modelEnd - modelPtr), sizeof(model) - 1);
                    strncpy(model, modelPtr, len);
                }
            }
            
            // 解析 key
            char key[64] = {0};
            const char* keyPtr = strstr(end, "\"key\":\"");
            if (keyPtr) {
                keyPtr += 7;
                const char* keyEnd = strchr(keyPtr, '"');
                if (keyEnd) {
                    size_t len = min((size_t)(keyEnd - keyPtr), sizeof(key) - 1);
                    strncpy(key, keyPtr, len);
                }
            }
            
            if (url[0] != '\0') {
                addCustomEndpoint(url, model, key);
            }
            
            ptr = end + 1;
        }
    }
    
    /**
     * 清除所有自定义端点
     */
    void clearCustomEndpoints() {
        customCount = 0;
    }
    
    /**
     * 分析数据 (自动选择最佳端点)
     * 优先级: 自定义端点 > 默认端点
     */
    bool analyze(const char* data, ModelResponse& response) {
        memset(&response, 0, sizeof(response));
        
        // 1. 尝试自定义端点 (按顺序)
        for (uint8_t i = 0; i < customCount; i++) {
            if (callEndpoint(customEndpoints[i], data, response)) {
                DEBUG_PRINTF("[AI] Success via custom #%d\n", i);
                return true;
            }
        }
        
        // 2. 回退到默认端点 (笔记本)
        if (callEndpoint(defaultEndpoint, data, response)) {
            DEBUG_PRINTLN("[AI] Success via default");
            return true;
        }
        
        DEBUG_PRINTLN("[AI] All endpoints failed");
        strcpy(response.result, "Model unavailable");
        response.threatLevel = 0;
        strcpy(response.action, "none");
        return false;
    }
    
    /**
     * 设置默认端点
     */
    void setDefaultEndpoint(const char* url, const char* model = nullptr) {
        strncpy(defaultEndpoint.url, url, sizeof(defaultEndpoint.url) - 1);
        if (model) {
            strncpy(defaultEndpoint.modelName, model, sizeof(defaultEndpoint.modelName) - 1);
        }
    }
    
    /**
     * 测试端点连通性
     */
    bool testEndpoint(uint8_t index) {
        ModelResponse resp;
        
        if (index == 255) {
            // 测试默认端点
            return callEndpoint(defaultEndpoint, "test", resp);
        } else if (index < customCount) {
            return callEndpoint(customEndpoints[index], "test", resp);
        }
        
        return false;
    }
    
    uint8_t getCustomCount() const { return customCount; }
};

#endif // AI_MODEL_H
