/**
 * Regression test — AG-B01: deployment bundle heredoc marker injection
 * Target: POST /api/deployments/generate-bundle (deployments.routes.ts)
 *
 * Original finding (VERIFIED, PoC 2/2 PASS pre-fix): /generate-bundle did
 * NOT invoke inputValidator.validateRequest (unlike /generate) and
 * validateProfile only checked non-empty strings / numeric ranges, so
 * profile.serverName could contain newlines plus the predictable heredoc
 * marker string `__AETHERGUARD_BUNDLE_<index>__`. That terminated the
 * heredoc early and smuggled attacker-controlled TOP-LEVEL shell lines
 * into the self-extracting installer (runs as root on the target).
 *
 * Post-fix expectations:
 * - Control characters in profile string fields are rejected (400) on
 *   /generate-bundle AND /generate AND /save.
 * - Heredoc markers are per-bundle 128-bit random tokens; a request author
 *   cannot know or reproduce the marker, and generation fail-closes on any
 *   collision with file content.
 * - Caller-supplied deploymentId is validated before interpolation into
 *   TARGET_DIR.
 *
 * Auth note: route requires admin (T7 malicious/duped operator). Auth is
 * mocked here because the vulnerability under test is the sink, not auth.
 */
import request from 'supertest';
import express from 'express';
import deploymentsRouter from '../../backend/src/api/routes/deployments.routes';

jest.mock('../../backend/src/middleware/auth.middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-user', role: 'admin', tenantId: 'tenant-001' };
    next();
  }),
  requireRole: jest.fn(() => (req: any, _res: any, next: any) => next()),
  AuthenticatedRequest: jest.fn()
}));

jest.mock('../../backend/src/utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
}));

jest.mock('../../backend/src/modules/deployments/deployment-profile.repository', () => ({
  getDeploymentProfile: jest.fn(),
  getNextDeploymentProfileVersion: jest.fn(() => 1),
  listDeploymentProfiles: jest.fn(() => []),
  saveDeploymentProfile: jest.fn()
}));

jest.mock('../../backend/src/security/audit-logger.service', () => ({
  __esModule: true,
  default: { log: jest.fn().mockResolvedValue(undefined) }
}));

jest.mock('../../backend/src/services/command-dispatcher.service', () => ({
  commandDispatcherService: { dispatchDeviceCommand: jest.fn() }
}));

// Legacy marker (pre-fix). Post-fix markers are random per bundle.
const LEGACY_MARKER = '__AETHERGUARD_BUNDLE_1__';
const PAYLOAD_LINE = 'echo PWNED_BUNDLE_MARKER_ESCAPE';
const EVIL_SERVER_NAME = `api.example.com\n${LEGACY_MARKER}\n${PAYLOAD_LINE}\n#`;

const BASE_PROFILE = { serverName: 'api.example.com', port: 8080, upstream: 'http://backend:3005', rateLimit: 100 };

describe('Regression AG-B01: generate-bundle heredoc marker injection (FIXED)', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/deployments', deploymentsRouter);

  test('A) /generate-bundle now rejects newline+marker in serverName with 400 invalid_profile', async () => {
    const res = await request(app)
      .post('/api/deployments/generate-bundle')
      .send({ serverType: 'nginx', profile: { ...BASE_PROFILE, serverName: EVIL_SERVER_NAME } });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('backend.invalid_profile');
  });

  test('B) /generate still rejects the same payload (400)', async () => {
    const res = await request(app)
      .post('/api/deployments/generate')
      .send({ serverType: 'nginx', profile: { ...BASE_PROFILE, serverName: EVIL_SERVER_NAME } });

    expect(res.status).toBe(400);
  });

  test('C) legitimate bundle uses a random heredoc marker that appears only as open/close pairs, never in content', async () => {
    const res = await request(app)
      .post('/api/deployments/generate-bundle')
      .send({ serverType: 'nginx', profile: BASE_PROFILE });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const script = Buffer.from(res.body.data.bundleBase64, 'base64').toString('utf8');
    // Marker extraction: find the first heredoc opener `<<'AGBUNDLE_...'`
    const openerMatch = script.match(/<<'(AGBUNDLE_[0-9A-F]{32})'/);
    expect(openerMatch).not.toBeNull();
    const marker = openerMatch![1];

    const lines = script.split('\n');
    // Every marker line is either a heredoc opener or closer — count both.
    const openers = lines.filter((l) => l.includes(`<<'${marker}'`)).length;
    const closers = lines.filter((l) => l.trim() === marker).length;
    expect(openers).toBeGreaterThan(0);
    expect(closers).toBe(openers);

    // The legacy predictable marker must never appear.
    expect(script).not.toContain(LEGACY_MARKER);
  });

  test('D) unsafe caller-supplied deploymentId is rejected (command interpolation into TARGET_DIR)', async () => {
    const res = await request(app)
      .post('/api/deployments/generate-bundle')
      .send({
        serverType: 'nginx',
        profile: BASE_PROFILE,
        deploymentId: 'x"$(reboot)"'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('backend.invalid_deployment_id');
  });

  test('E) control chars in other profile string fields are rejected too', async () => {
    for (const field of ['upstream', 'namespace', 'image', 'apiKey']) {
      const res = await request(app)
        .post('/api/deployments/generate-bundle')
        .send({ serverType: 'nginx', profile: { ...BASE_PROFILE, [field]: `a\nb'${PAYLOAD_LINE}'` } });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('backend.invalid_profile');
    }
  });
});
