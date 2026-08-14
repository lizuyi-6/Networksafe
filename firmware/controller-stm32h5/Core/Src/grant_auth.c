/**
 * @file grant_auth.c
 * @brief SHA-256 + HMAC-SHA256 + constant-time compare (no dynamic memory)
 *
 * Standard implementations: FIPS 180-4 (SHA-256) and RFC 2104 (HMAC).
 * Correctness is pinned by host tests against the official RFC 4231
 * HMAC-SHA256 test vectors and FIPS 180-4 SHA-256 vectors — see
 * test/test_controller.c (test_grant_auth_rfc_vectors).
 */

#include "main.h"
#include "grant_auth.h"
#include <string.h>
#include <stdio.h>

/* ------------------------------------------------------------------ */
/* SHA-256 (FIPS 180-4)                                               */
/* ------------------------------------------------------------------ */

typedef struct {
    uint32_t state[8];
    uint64_t bitlen;
    uint8_t  block[64];
    uint32_t block_fill;
} sha256_ctx_t;

static const uint32_t SHA256_K[64] = {
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u,
    0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
    0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
    0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
    0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu,
    0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
    0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
    0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
    0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u,
    0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u,
    0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
    0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u
};

#define ROTR32(x, n) (((x) >> (n)) | ((x) << (32 - (n))))

static void sha256_transform(sha256_ctx_t *ctx, const uint8_t block[64]) {
    uint32_t w[64];
    for (uint32_t i = 0; i < 16; i++) {
        w[i] = ((uint32_t)block[i * 4] << 24)
             | ((uint32_t)block[i * 4 + 1] << 16)
             | ((uint32_t)block[i * 4 + 2] << 8)
             | ((uint32_t)block[i * 4 + 3]);
    }
    for (uint32_t i = 16; i < 64; i++) {
        uint32_t s0 = ROTR32(w[i - 15], 7) ^ ROTR32(w[i - 15], 18) ^ (w[i - 15] >> 3);
        uint32_t s1 = ROTR32(w[i - 2], 17) ^ ROTR32(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }

    uint32_t a = ctx->state[0], b = ctx->state[1], c = ctx->state[2], d = ctx->state[3];
    uint32_t e = ctx->state[4], f = ctx->state[5], g = ctx->state[6], h = ctx->state[7];

    for (uint32_t i = 0; i < 64; i++) {
        uint32_t S1 = ROTR32(e, 6) ^ ROTR32(e, 11) ^ ROTR32(e, 25);
        uint32_t ch = (e & f) ^ ((~e) & g);
        uint32_t t1 = h + S1 + ch + SHA256_K[i] + w[i];
        uint32_t S0 = ROTR32(a, 2) ^ ROTR32(a, 13) ^ ROTR32(a, 22);
        uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
        uint32_t t2 = S0 + maj;

        h = g; g = f; f = e; e = d + t1;
        d = c; c = b; b = a; a = t1 + t2;
    }

    ctx->state[0] += a; ctx->state[1] += b; ctx->state[2] += c; ctx->state[3] += d;
    ctx->state[4] += e; ctx->state[5] += f; ctx->state[6] += g; ctx->state[7] += h;
}

static void sha256_init(sha256_ctx_t *ctx) {
    ctx->state[0] = 0x6a09e667u; ctx->state[1] = 0xbb67ae85u;
    ctx->state[2] = 0x3c6ef372u; ctx->state[3] = 0xa54ff53au;
    ctx->state[4] = 0x510e527fu; ctx->state[5] = 0x9b05688cu;
    ctx->state[6] = 0x1f83d9abu; ctx->state[7] = 0x5be0cd19u;
    ctx->bitlen = 0;
    ctx->block_fill = 0;
}

static void sha256_update(sha256_ctx_t *ctx, const uint8_t *data, uint32_t len) {
    ctx->bitlen += (uint64_t)len * 8u;
    while (len > 0) {
        uint32_t take = 64u - ctx->block_fill;
        if (take > len) take = len;
        memcpy(ctx->block + ctx->block_fill, data, take);
        ctx->block_fill += take;
        data += take;
        len -= take;
        if (ctx->block_fill == 64u) {
            sha256_transform(ctx, ctx->block);
            ctx->block_fill = 0;
        }
    }
}

static void sha256_final(sha256_ctx_t *ctx, uint8_t out[32]) {
    uint64_t bitlen = ctx->bitlen;
    uint8_t pad = 0x80u;
    sha256_update(ctx, &pad, 1);
    uint8_t zero = 0;
    while (ctx->block_fill != 56u) {
        sha256_update(ctx, &zero, 1);
    }
    /* Length in big-endian — appended without going through update()
     * (which would corrupt bitlen). */
    uint8_t len_be[8];
    for (int i = 0; i < 8; i++) {
        len_be[i] = (uint8_t)(bitlen >> (56 - 8 * i));
    }
    ctx->bitlen = bitlen; /* restore: the padding bytes are not message bits */
    memcpy(ctx->block + 56, len_be, 8);
    sha256_transform(ctx, ctx->block);
    for (uint32_t i = 0; i < 8; i++) {
        out[i * 4]     = (uint8_t)(ctx->state[i] >> 24);
        out[i * 4 + 1] = (uint8_t)(ctx->state[i] >> 16);
        out[i * 4 + 2] = (uint8_t)(ctx->state[i] >> 8);
        out[i * 4 + 3] = (uint8_t)(ctx->state[i]);
    }
}

void grant_auth_sha256(const uint8_t *data, uint32_t data_len, uint8_t out[32]) {
    sha256_ctx_t ctx;
    sha256_init(&ctx);
    sha256_update(&ctx, data, data_len);
    sha256_final(&ctx, out);
}

/* ------------------------------------------------------------------ */
/* HMAC-SHA256 (RFC 2104)                                             */
/* ------------------------------------------------------------------ */

void grant_auth_hmac_sha256(const uint8_t *key, uint16_t key_len,
                            const uint8_t *data, uint32_t data_len,
                            uint8_t out[GRANT_AUTH_MAC_BYTES]) {
    uint8_t k_block[64];
    uint8_t k_pad_inner[64];
    uint8_t k_pad_outer[64];
    uint8_t inner_hash[32];

    if (key_len > 64u) {
        /* Long keys are hashed first (RFC 2104 §2). */
        grant_auth_sha256(key, key_len, k_block);
        memset(k_block + 32, 0, 32);
    } else {
        memcpy(k_block, key, key_len);
        memset(k_block + key_len, 0, 64u - key_len);
    }

    for (uint32_t i = 0; i < 64u; i++) {
        k_pad_inner[i] = k_block[i] ^ 0x36u;
        k_pad_outer[i] = k_block[i] ^ 0x5cu;
    }

    sha256_ctx_t ctx;
    sha256_init(&ctx);
    sha256_update(&ctx, k_pad_inner, 64u);
    sha256_update(&ctx, data, data_len);
    sha256_final(&ctx, inner_hash);

    sha256_init(&ctx);
    sha256_update(&ctx, k_pad_outer, 64u);
    sha256_update(&ctx, inner_hash, 32u);
    sha256_final(&ctx, out);
}

/* ------------------------------------------------------------------ */
/* Constant-time compare                                              */
/* ------------------------------------------------------------------ */

bool grant_auth_constant_time_equal(const uint8_t *a, const uint8_t *b, uint16_t len) {
    volatile uint8_t diff = 0;
    for (uint16_t i = 0; i < len; i++) {
        diff |= (uint8_t)(a[i] ^ b[i]);
    }
    return diff == 0;
}

/* ------------------------------------------------------------------ */
/* Canonical grant message                                            */
/* ------------------------------------------------------------------ */

uint16_t grant_auth_build_message(char *out, uint16_t out_len,
                                  const char *challenge,
                                  const char *policy_digest,
                                  uint32_t monotonic_counter,
                                  uint32_t expires_at) {
    int n = snprintf(out, out_len, "%s|%s|%lu|%lu",
                     challenge, policy_digest,
                     (unsigned long)monotonic_counter,
                     (unsigned long)expires_at);
    if (n < 0 || (uint16_t)n >= out_len) {
        return 0;
    }
    return (uint16_t)n;
}
