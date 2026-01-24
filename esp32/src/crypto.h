/**
 * FluxGuard ESP32 - 优化版加密模块
 * 
 * 优化策略：
 * - 可选打开 AES-128 (比 AES-256 快 40%)
 * - 使用 ESP32 硬件加速器
 * - 避免动态内存分配
 * - 简化的 XOR 备选方案 (极低功耗场景)
 */

#ifndef CRYPTO_H
#define CRYPTO_H

#include <Arduino.h>
#include "config.h"

#if ENABLE_ENCRYPTION
#include "mbedtls/aes.h"
#include "mbedtls/base64.h"
#endif

// 加密类型选择
enum CryptoType : uint8_t {
    CRYPTO_NONE = 0,
    CRYPTO_XOR = 1,     // 最轻量 (不安全，仅混淆)
    CRYPTO_AES128 = 2,  // 推荐 (平衡)
    CRYPTO_AES256 = 3   // 最安全 (最慢)
};

class Crypto {
private:
#if ENABLE_ENCRYPTION
    mbedtls_aes_context aesCtx;
    bool aesInitialized;
#endif
    
    uint8_t key[32];
    uint8_t iv[16];
    CryptoType currentType;
    
    // 静态工作缓冲区
    uint8_t workBuffer[JSON_BUFFER_SIZE];
    
    /**
     * 简单 XOR 加密 (CPU 开销最小)
     */
    void xorCrypt(uint8_t* data, uint16_t len) {
        for (uint16_t i = 0; i < len; i++) {
            data[i] ^= key[i % 16];
        }
    }

public:
    Crypto() {
#if ENABLE_ENCRYPTION
        aesInitialized = false;
#endif
        currentType = CRYPTO_NONE;
    }
    
    bool init(const char* aesKey, const char* aesIv, CryptoType type = CRYPTO_AES128) {
        currentType = type;
        
        // 复制密钥
        memset(key, 0, sizeof(key));
        memset(iv, 0, sizeof(iv));
        
        size_t keyLen = strlen(aesKey);
        size_t ivLen = strlen(aesIv);
        memcpy(key, aesKey, min(keyLen, sizeof(key)));
        memcpy(iv, aesIv, min(ivLen, sizeof(iv)));
        
#if ENABLE_ENCRYPTION
        if (type >= CRYPTO_AES128) {
            mbedtls_aes_init(&aesCtx);
            
            // AES-128 = 128位密钥, AES-256 = 256位密钥
            int bits = (type == CRYPTO_AES256) ? 256 : 128;
            mbedtls_aes_setkey_enc(&aesCtx, key, bits);
            aesInitialized = true;
            
            DEBUG_PRINTF("[Crypto] AES-%d ready\n", bits);
        }
#endif
        
        return true;
    }
    
    /**
     * 加密数据 (原地加密，避免额外内存)
     * 返回加密后长度 (可能因填充增加)
     */
    uint16_t encrypt(uint8_t* data, uint16_t len) {
        if (len == 0 || len > JSON_BUFFER_SIZE - 16) return 0;
        
        switch (currentType) {
            case CRYPTO_XOR:
                xorCrypt(data, len);
                return len;
                
#if ENABLE_ENCRYPTION
            case CRYPTO_AES128:
            case CRYPTO_AES256: {
                if (!aesInitialized) return 0;
                
                // PKCS7 填充到 16 字节对齐
                uint16_t paddedLen = ((len / 16) + 1) * 16;
                uint8_t padValue = paddedLen - len;
                
                // 填充
                for (uint16_t i = len; i < paddedLen; i++) {
                    data[i] = padValue;
                }
                
                // 复制 IV
                uint8_t ivCopy[16];
                memcpy(ivCopy, iv, 16);
                
                // CBC 加密 (使用工作缓冲区)
                mbedtls_aes_crypt_cbc(&aesCtx, MBEDTLS_AES_ENCRYPT,
                                     paddedLen, ivCopy, data, workBuffer);
                
                // 复制回原缓冲区
                memcpy(data, workBuffer, paddedLen);
                return paddedLen;
            }
#endif
            
            default:
                return len;  // 不加密
        }
    }
    
    /**
     * 解密数据 (原地解密)
     * 返回解密后实际长度
     */
    uint16_t decrypt(uint8_t* data, uint16_t len) {
        if (len == 0) return 0;
        
        switch (currentType) {
            case CRYPTO_XOR:
                xorCrypt(data, len);  // XOR 对称
                return len;
                
#if ENABLE_ENCRYPTION
            case CRYPTO_AES128:
            case CRYPTO_AES256: {
                if (!aesInitialized || len % 16 != 0) return 0;
                
                // 初始化解密上下文
                mbedtls_aes_context decCtx;
                mbedtls_aes_init(&decCtx);
                int bits = (currentType == CRYPTO_AES256) ? 256 : 128;
                mbedtls_aes_setkey_dec(&decCtx, key, bits);
                
                // 复制 IV
                uint8_t ivCopy[16];
                memcpy(ivCopy, iv, 16);
                
                // CBC 解密
                mbedtls_aes_crypt_cbc(&decCtx, MBEDTLS_AES_DECRYPT,
                                     len, ivCopy, data, workBuffer);
                mbedtls_aes_free(&decCtx);
                
                // 移除 PKCS7 填充
                uint8_t padValue = workBuffer[len - 1];
                uint16_t actualLen = len;
                if (padValue > 0 && padValue <= 16) {
                    actualLen = len - padValue;
                }
                
                // 复制回原缓冲区
                memcpy(data, workBuffer, actualLen);
                data[actualLen] = '\0';
                return actualLen;
            }
#endif
            
            default:
                return len;
        }
    }
    
    /**
     * Base64 编码 (用于 WebSocket 文本传输)
     */
    uint16_t encodeBase64(const uint8_t* input, uint16_t inputLen, 
                          char* output, uint16_t maxOutputLen) {
#if ENABLE_ENCRYPTION
        size_t outputLen = 0;
        mbedtls_base64_encode((unsigned char*)output, maxOutputLen,
                              &outputLen, input, inputLen);
        return (uint16_t)outputLen;
#else
        // 简化版 Base64 (仅当禁用加密时)
        static const char* table = 
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        
        uint16_t outIdx = 0;
        for (uint16_t i = 0; i < inputLen && outIdx < maxOutputLen - 4; i += 3) {
            uint32_t n = ((uint32_t)input[i]) << 16;
            if (i + 1 < inputLen) n |= ((uint32_t)input[i+1]) << 8;
            if (i + 2 < inputLen) n |= input[i+2];
            
            output[outIdx++] = table[(n >> 18) & 0x3F];
            output[outIdx++] = table[(n >> 12) & 0x3F];
            output[outIdx++] = (i + 1 < inputLen) ? table[(n >> 6) & 0x3F] : '=';
            output[outIdx++] = (i + 2 < inputLen) ? table[n & 0x3F] : '=';
        }
        output[outIdx] = '\0';
        return outIdx;
#endif
    }
    
    CryptoType getType() const { return currentType; }
    void setType(CryptoType t) { currentType = t; }
    
    ~Crypto() {
#if ENABLE_ENCRYPTION
        if (aesInitialized) {
            mbedtls_aes_free(&aesCtx);
        }
#endif
    }
};

#endif // CRYPTO_H
