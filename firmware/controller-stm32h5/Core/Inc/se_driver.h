/**
 * @file se_driver.h
 * @brief M3 Secure Element Driver (I2C)
 *
 * Driver for OPTIGA Trust M / SE050 / ATECC608B.
 * Implements subset needed for grant signature verification.
 */

#ifndef SE_DRIVER_H
#define SE_DRIVER_H

#include <stdint.h>
#include <stdbool.h>

#define SE_I2C_ADDR_OPTIGA_TRUST_M  0x30  // 7-bit address
#define SE_I2C_ADDR_SE050           0x48
#define SE_I2C_ADDR_ATECC608        0x60

/* SE initialization */
bool se_init(void);

/* Check if SE is present and responsive */
bool se_is_present(void);

/* Get device certificate / public key (DER format) */
bool se_get_public_key(uint8_t *out_pubkey, uint16_t *out_len);

/* ECDSA P-256 signature verification (used by Gateway Daemon, not controller) */
// Controller does not verify signatures; it trusts the Gateway Daemon.
// The SE is used for device identity and signing outbound messages only.

/* Sign a message with device private key (ECDSA P-256) */
bool se_sign(const uint8_t *message, uint16_t message_len,
             uint8_t *out_signature, uint16_t *out_sig_len);

/* Read monotonic counter (OPTIGA Trust M feature) */
bool se_read_counter(uint32_t *out_counter);

/* Increment monotonic counter */
bool se_increment_counter(uint32_t *out_new_counter);

#endif /* SE_DRIVER_H */
