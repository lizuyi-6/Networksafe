import { createSign, createVerify, generateKeyPairSync, KeyObject } from 'crypto';
import { buildHardwareGrantMessage, type HardwareGrantEnvelope } from '../../backend/src/security/hardware-grant';

/**
 * M3: Secure Element Mock
 *
 * Simulates OPTIGA Trust M / SE050 / ATECC608B:
 * - Device identity (non-exportable private key)
 * - ECDSA P-256 signing over SHA-256
 * - Grant signature verification
 *
 * In real hardware:
 * - Private key is generated inside the SE and never leaves it
 * - Signing is done via I2C/SPI commands (no key export)
 * - Monotonic counter can be hardware-backed (OPTIGA Trust M supports this)
 *
 * This mock uses Node crypto with the same algorithm so grant signatures
 * are interchangeable with real hardware.
 */

export interface SecureElementConfig {
  deviceId: string;
}

export class MockSecureElement {
  readonly deviceId: string;
  private privateKey: KeyObject;
  private publicKey: KeyObject;
  private monotonicCounter: number = 0;
  private available: boolean = true;

  constructor(config: SecureElementConfig) {
    this.deviceId = config.deviceId;
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    console.log(`🔵 [M3 SE] Provisioned: ${this.deviceId} (ECDSA P-256)`);
  }

  /**
   * Export public key (PEM). In real hardware this is readable but the private key is not.
   */
  getPublicKeyPem(): string {
    return this.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }

  /**
   * Sign a grant. In real hardware this is done via I2C command (e.g. OPTIGA_CRYPT_ECDSA_SIGN).
   * Returns base64 signature.
   */
  signGrant(grant: Omit<HardwareGrantEnvelope, 'signature'>): string {
    if (!this.available) {
      throw new Error('SE unavailable');
    }
    const message = buildHardwareGrantMessage(grant as HardwareGrantEnvelope);
    const sig = createSign('SHA256').update(message).end().sign(this.privateKey, 'base64');
    return sig;
  }

  /**
   * Verify a grant signature against this SE's public key.
   * In real hardware the controller would call this, but typically grant verification
   * happens on the Gateway Daemon side (it has the SE public key provisioned).
   */
  verifyGrant(grant: HardwareGrantEnvelope): boolean {
    if (!this.available) {
      return false;
    }
    const message = buildHardwareGrantMessage(grant);
    try {
      return createVerify('SHA256')
        .update(message)
        .end()
        .verify(this.publicKey, grant.signature, 'base64');
    } catch {
      return false;
    }
  }

  /**
   * Read monotonic counter. In real OPTIGA Trust M this is a hardware-backed counter
   * that survives power cycles and cannot roll back.
   */
  readMonotonicCounter(): number {
    if (!this.available) {
      throw new Error('SE unavailable');
    }
    return this.monotonicCounter;
  }

  /**
   * Increment monotonic counter. Returns new value.
   */
  incrementMonotonicCounter(): number {
    if (!this.available) {
      throw new Error('SE unavailable');
    }
    this.monotonicCounter++;
    return this.monotonicCounter;
  }

  /**
   * Simulate SE hardware failure (for testing PRD trigger #5).
   */
  simulateFailure(): void {
    this.available = false;
    console.log(`🔵 [M3 SE] ⚠️  Simulated failure: SE unavailable`);
  }

  /**
   * Restore SE availability.
   */
  restore(): void {
    this.available = true;
    console.log(`🔵 [M3 SE] Restored: SE available`);
  }

  isAvailable(): boolean {
    return this.available;
  }
}
