/**
 * @file grant_auth.h
 * @brief M1<->M2 serial channel authentication (HMAC-SHA256)
 *
 * SECURITY FIX (audit 2026-08, FW-001): the M2 controller previously
 * accepted interlock_release frames with structural checks only — a UART
 * attacker who knew the (compile-time-constant) policy digest could drive
 * the relay with a forged frame. The M1->M2 serial hop is now
 * authenticated: M1 computes HMAC-SHA256 over the canonical grant message
 * with a provisioned channel key, and M2 refuses (fail-closed) any release
 * whose MAC does not verify.
 *
 * Key model: 32-byte symmetric channel key provisioned at manufacturing /
 * pairing time via controller_provision_serial_channel_key(). Until a key
 * is provisioned, ALL release requests are denied (fail-closed, never
 * fail-open). The end-state architecture moves this key into the Secure
 * Element (OPTIGA HMAC-Verify with a protected secret object); this
 * software implementation keeps the fail-closed enforcement in the
 * controller while remaining host-testable without hardware.
 */

#ifndef GRANT_AUTH_H
#define GRANT_AUTH_H

#include <stdint.h>
#include <stdbool.h>

#define GRANT_AUTH_KEY_BYTES  32u   /* 256-bit channel key */
#define GRANT_AUTH_MAC_BYTES  32u   /* HMAC-SHA256 output */

/**
 * Canonical message bound by the channel MAC. Same construction on M1
 * (backend/src/companion/gateway-daemon.ts, signSerialChannelMac) and M2.
 * Field order: challenge | policyDigest | monotonicCounter | expiresAt,
 * decimal integers, '|' separators, no whitespace.
 *
 * Returns the number of bytes written (excluding NUL), or 0 if the buffer
 * is too small (can never happen for well-formed grants: 63+1+63+1+10+1+10
 * + 1 < GRANT_AUTH_MAX_MESSAGE).
 */
#define GRANT_AUTH_MAX_MESSAGE 192u

uint16_t grant_auth_build_message(char *out, uint16_t out_len,
                                  const char *challenge,
                                  const char *policy_digest,
                                  uint32_t monotonic_counter,
                                  uint32_t expires_at);

/** SHA-256 (FIPS 180-4). Exposed for test vectors. */
void grant_auth_sha256(const uint8_t *data, uint32_t data_len, uint8_t out[32]);

/** HMAC-SHA256 (RFC 2104) over data with key. */
void grant_auth_hmac_sha256(const uint8_t *key, uint16_t key_len,
                            const uint8_t *data, uint32_t data_len,
                            uint8_t out[GRANT_AUTH_MAC_BYTES]);

/** Constant-time byte comparison (length must match to return true). */
bool grant_auth_constant_time_equal(const uint8_t *a, const uint8_t *b, uint16_t len);

#endif /* GRANT_AUTH_H */
