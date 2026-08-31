/**
 * SECURITY regression tests (audit 2026-08, AUD-08-1 P2 slices):
 *   1. tiered body limits — non-upload JSON routes reject >1mb bodies;
 *   2. Origin gate — cookie-credentialed writes with a disallowed Origin
 *      are 403, allowlisted origins pass, non-browser (no Origin) passes;
 *   3. audit backup export/verify share ONE canonical checksum.
 */
import request from 'supertest';
import { initDatabase } from '../../config/database';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

describe('AUD-08-1 P2 slices', () => {
  let app: any;

  beforeAll(async () => {
    process.env.ALLOW_TEST_RUNTIME = 'true';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-minimum-32-characters-long';
    process.env.AUDIT_LOG_SECRET = process.env.AUDIT_LOG_SECRET || 'test-audit-log-secret-minimum-32-characters';
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-32-chars-ok!';
    process.env.ENCRYPTION_SALT = process.env.ENCRYPTION_SALT || 'test-salt-16-char!';
    await initDatabase();
    const { createControlPlaneApp } = await import('../../bootstrap/control-plane-app');
    app = createControlPlaneApp({
      runtime: {
        profile: 'dev',
        dbMode: 'sqlite',
        sqliteFallbackEnabled: true,
        apiEnabled: true
      },
      getAgentCount: () => 0
    } as any);
  });

  describe('tiered body limits', () => {
    it('rejects a 2mb JSON body on a normal route (global 1mb cap)', async () => {
      const big = { pad: 'x'.repeat(2 * 1024 * 1024) };
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send(big);
      // body-parser surfaces PayloadTooLarge before the route runs.
      expect(res.status).toBe(413);
    });

    it('accepts a small JSON body (parser operational)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send({});
      // The login route processed the request (validation failure), so the
      // parser did not smother it.
      expect([400, 401]).toContain(res.status);
    });
  });

  describe('Origin gate (cookie-credentialed writes)', () => {
    it('blocks a disallowed Origin on POST with cookies', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Cookie', 'accessToken=whatever')
        .set('Origin', 'https://evil.example.com')
        .send({});
      expect(res.status).toBe(403);
    });

    it('allows a POST without Origin (non-browser client)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Cookie', 'accessToken=whatever')
        .send({});
      // Route-level status (validation/auth), NOT the Origin gate's 403.
      expect(res.status).not.toBe(403);
    });
  });

  describe('audit backup canonical checksum', () => {
    it('verifies an exported backup as valid, and a tampered one as invalid', async () => {
      const mod = await import('../../security/audit-logger.service');
      const auditLogger = mod.default;
      const path = require('path');
      const fs = require('fs');
      const target = path.join(process.env.DATA_DIR || './test-data', `backup-verify-${Date.now()}.json`);
      const exported = await auditLogger.exportBackup(target);
      expect(exported.success).toBe(true);

      const verified = await auditLogger.verifyBackupFile(target);
      expect(verified.valid).toBe(true);

      // Tamper with one log entry -> checksum must fail.
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (parsed.logs.length > 0) {
        parsed.logs[0].action = 'tampered-action';
        const tamperedPath = `${target}.tampered`;
        fs.writeFileSync(tamperedPath, JSON.stringify(parsed, null, 2));
        const bad = await auditLogger.verifyBackupFile(tamperedPath);
        expect(bad.valid).toBe(false);
        expect(bad.reason).toBe('checksum_mismatch');
      }
      expect(exported.checksum).toBeDefined();
    });

    it('N5-5: catches record tampering even when the attacker RECOMPUTES the keyless whole-file checksum', async () => {
      const mod = await import('../../security/audit-logger.service');
      const auditLogger = mod.default;
      const { AuditLogger } = mod;
      const path = require('path');
      const fs = require('fs');
      const target = path.join(process.env.DATA_DIR || './test-data', `backup-record-hmac-${Date.now()}.json`);
      const exported = await auditLogger.exportBackup(target);
      expect(exported.success).toBe(true);
      expect(exported.recordCount).toBeGreaterThan(0);

      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      expect(parsed.version).toBe('1.1');

      // Forge a record AND recompute the outer checksum exactly like the
      // verifier does — the keyless checksum now passes; only the per-record
      // HMAC (audit-secret keyed) can catch the forgery.
      parsed.logs[0].action = 'forged-action';
      const { checksum, ...withoutChecksum } = parsed;
      parsed.checksum = AuditLogger.computeBackupChecksum(withoutChecksum);
      const forgedPath = `${target}.forged`;
      fs.writeFileSync(forgedPath, JSON.stringify(parsed, null, 2));

      const result = await auditLogger.verifyBackupFile(forgedPath);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('record_signature_invalid');
      expect(result.perRecordVerified).toBe(true);
      expect(result.invalidRecordIds).toContain(parsed.logs[0].id);

      // The pristine file still verifies with per-record HMACs.
      const good = await auditLogger.verifyBackupFile(target);
      expect(good.valid).toBe(true);
      expect(good.perRecordVerified).toBe(true);
    });
  });
});
