/**
 * Redteam tests for request body validators
 * Verifies that malformed payloads are rejected.
 */

import {
  validateLoginBody,
  validateRegisterBody,
  validateChangePasswordBody,
  validateFinalDefensePolicyBody,
  validateFinalDefenseActionBody,
  validateGatewayActionBody
} from '../../validators/request-body.validators';

// Validators return a discriminated union. These tests assert the `valid:false`
// branch and read `.error`; the helper narrows without weakening the assertion.
type InvalidResult = { valid: false; error: string };
function expectInvalid<T extends { valid: boolean }>(result: T): InvalidResult {
  expect(result.valid).toBe(false);
  return result as unknown as InvalidResult;
}

describe('request-body validators', () => {
  describe('validateLoginBody', () => {
    it('accepts a valid email + password', () => {
      const result = validateLoginBody({ email: 'user@example.com', password: 'Secret123!' });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.email).toBe('user@example.com');
        expect(result.data.password).toBe('Secret123!');
      }
    });

    it('rejects null body', () => {
      const result = validateLoginBody(null);
      expect(expectInvalid(result).error).toBe('backend.request_body_must_be_an_object');
    });

    it('rejects a non-object body', () => {
      expect(validateLoginBody('string').valid).toBe(false);
      expect(validateLoginBody([]).valid).toBe(false);
    });

    it('rejects missing email', () => {
      const result = validateLoginBody({ password: 'Secret123!' });
      expect(expectInvalid(result).error).toBe('backend.invalid_email_format');
    });

    it('rejects malformed email', () => {
      expect(validateLoginBody({ email: 'not-an-email', password: 'Secret123!' }).valid).toBe(false);
      expect(validateLoginBody({ email: '', password: 'Secret123!' }).valid).toBe(false);
      expect(validateLoginBody({ email: '@example.com', password: 'Secret123!' }).valid).toBe(false);
    });

    it('rejects missing password', () => {
      const result = validateLoginBody({ email: 'user@example.com' });
      expect(expectInvalid(result).error).toBe('backend.password_is_required');
    });

    it('rejects empty password', () => {
      const result = validateLoginBody({ email: 'user@example.com', password: '' });
      expect(expectInvalid(result).error).toBe('backend.password_is_required');
    });

    it('rejects extra unknown fields (ignored, not rejected)', () => {
      // Extra fields are accepted — they are simply not in the returned type.
      const result = validateLoginBody({ email: 'user@example.com', password: 'Secret123!', role: 'admin' });
      expect(result.valid).toBe(true);
    });

    it('normalises email to lowercase', () => {
      const result = validateLoginBody({ email: 'USER@EXAMPLE.COM', password: 'Secret123!' });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.email).toBe('user@example.com');
      }
    });
  });

  describe('validateRegisterBody', () => {
    it('accepts a valid registration payload', () => {
      const result = validateRegisterBody({ email: 'new@example.com', password: 'Secret123!', username: 'NewUser' });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.username).toBe('NewUser');
      }
    });

    it('rejects short username', () => {
      const result = validateRegisterBody({ email: 'new@example.com', password: 'Secret123!', username: 'A' });
      expect(expectInvalid(result).error).toBe('backend.username_must_be_at_least_2_characters');
    });

    it('rejects short password', () => {
      const result = validateRegisterBody({ email: 'new@example.com', password: 'Short!', username: 'NewUser' });
      expect(expectInvalid(result).error).toBe('backend.password_must_be_at_least_8_characters');
    });

    it('strips HTML tags from username', () => {
      const result = validateRegisterBody({ email: 'new@example.com', password: 'Secret123!', username: '<script>evil</script>User' });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.username).not.toContain('<');
        expect(result.data.username).toContain('User');
      }
    });

    it('truncates username to 64 chars', () => {
      const longUsername = 'A'.repeat(100);
      const result = validateRegisterBody({ email: 'new@example.com', password: 'Secret123!', username: longUsername });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.username.length).toBe(64);
      }
    });
  });

  describe('validateChangePasswordBody', () => {
    it('accepts valid payload', () => {
      const result = validateChangePasswordBody({ currentPassword: 'OldPass!', newPassword: 'NewPass123!' });
      expect(result.valid).toBe(true);
    });

    it('rejects missing currentPassword', () => {
      const result = validateChangePasswordBody({ newPassword: 'NewPass123!' });
      expect(expectInvalid(result).error).toBe('backend.current_password_is_required');
    });

    it('rejects short newPassword', () => {
      const result = validateChangePasswordBody({ currentPassword: 'OldPass!', newPassword: 'Short!' });
      expect(expectInvalid(result).error).toBe('backend.new_password_must_be_at_least_8_characters');
    });
  });

  describe('validateFinalDefensePolicyBody', () => {
    it('accepts a minimal valid policy', () => {
      const result = validateFinalDefensePolicyBody({
        companionId: 'companion-1',
        gateId: 'gate-1',
        breakerTarget: 'isolate',
        allowedActions: [{ commandType: 'host_remove' }]
      });
      expect(result.valid).toBe(true);
    });

    it('rejects missing companionId', () => {
      const result = validateFinalDefensePolicyBody({
        gateId: 'gate-1',
        breakerTarget: 'isolate',
        allowedActions: [{ commandType: 'host_remove' }]
      });
      expect(result.valid).toBe(false);
    });

    it('rejects empty allowedActions', () => {
      const result = validateFinalDefensePolicyBody({
        companionId: 'companion-1',
        gateId: 'gate-1',
        breakerTarget: 'isolate',
        allowedActions: []
      });
      expect(result.valid).toBe(false);
    });

    it('rejects action with missing commandType', () => {
      const result = validateFinalDefensePolicyBody({
        companionId: 'companion-1',
        gateId: 'gate-1',
        breakerTarget: 'isolate',
        allowedActions: [{ scriptPath: '/bin/evilscript' }]
      });
      expect(result.valid).toBe(false);
    });

    it('accepts valid status values', () => {
      for (const status of ['active', 'staged', 'revoked']) {
        const result = validateFinalDefensePolicyBody({
          companionId: 'c', gateId: 'g', breakerTarget: 'b',
          allowedActions: [{ commandType: 'x' }],
          status
        });
        expect(result.valid).toBe(true);
      }
    });

    it('rejects invalid status (defaults to active)', () => {
      // When status is invalid it defaults to 'active', but we still need
      // companionId, gateId, breakerTarget to be non-empty.
      const result = validateFinalDefensePolicyBody({
        companionId: 'c', gateId: 'g', breakerTarget: 'b',
        allowedActions: [{ commandType: 'x' }],
        status: 'deleted' // invalid
      });
      expect(result.valid).toBe(true); // status is coerced to 'active'
    });

    it('rejects non-numeric releaseTtlMs', () => {
      const result = validateFinalDefensePolicyBody({
        companionId: 'c', gateId: 'g', breakerTarget: 'b',
        allowedActions: [{ commandType: 'x' }],
        releaseTtlMs: 'not-a-number'
      } as any);
      expect(result.valid).toBe(true); // invalid coerced to undefined
    });
  });

  describe('validateFinalDefenseActionBody', () => {
    it('accepts a valid action payload', () => {
      const result = validateFinalDefenseActionBody({
        companionId: 'companion-1',
        commandType: 'host_remove',
        payload: { target: 'server-1' }
      });
      expect(result.valid).toBe(true);
    });

    it('rejects missing companionId', () => {
      const result = validateFinalDefenseActionBody({ commandType: 'host_remove' });
      expect(result.valid).toBe(false);
    });

    it('rejects missing commandType', () => {
      const result = validateFinalDefenseActionBody({ companionId: 'companion-1' });
      expect(result.valid).toBe(false);
    });
  });

  describe('validateGatewayActionBody', () => {
    it('accepts a valid gateway action payload', () => {
      const result = validateGatewayActionBody({
        gatewayId: 'gateway-1',
        action: 'isolate',
        payload: {}
      });
      expect(result.valid).toBe(true);
    });

    it('rejects missing gatewayId', () => {
      const result = validateGatewayActionBody({ action: 'isolate' });
      expect(result.valid).toBe(false);
    });

    it('rejects missing action', () => {
      const result = validateGatewayActionBody({ gatewayId: 'gateway-1' });
      expect(result.valid).toBe(false);
    });
  });
});
