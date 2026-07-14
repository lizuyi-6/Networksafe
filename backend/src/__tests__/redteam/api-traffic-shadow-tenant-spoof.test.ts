import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-minimum-32-characters-long';

jest.mock('../../services/security-operations.service', () => ({
  securityOperationsService: {
    syncSignalFinding: jest.fn()
  }
}));

jest.mock('../../services/fastpath-traffic-shadow.service', () => ({
  fastpathTrafficShadowService: {
    submitFromRequest: jest.fn()
  }
}));

import { initDatabase, closeDatabase, getDatabase } from '../../config/database';
import { apiTrafficShadowMiddleware } from '../../middleware/api-traffic-shadow.middleware';
import { authenticate } from '../../middleware/auth.middleware';
import { ANONYMOUS_TENANT_ID } from '../../core/tenant/tenant-context';
import { platformConfigService } from '../../services/platform-config.service';
import { detectionPipelineService } from '../../services/detection-pipeline.service';

const testDataDir = path.join(os.tmpdir(), 'aetherguard-api-shadow-tenant-spoof-test-data');
const victimTenantId = 'victim-tenant';

function countRows(table: 'sec_detection_events' | 'sec_rule_candidates', tenantId: string): number {
  const row = getDatabase().prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = ?`).get(tenantId);
  return Number(row?.count || 0);
}

describe('api traffic shadow tenant spoof isolation', () => {
  beforeAll(async () => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
    process.env.DATA_DIR = testDataDir;
    await initDatabase();
    platformConfigService.prepare();
    detectionPipelineService.prepare();
  });

  afterAll(() => {
    detectionPipelineService.setAiAnalyzer(null);
    closeDatabase();
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    const db = getDatabase();
    db.exec('DELETE FROM sec_detection_events');
    db.exec('DELETE FROM sec_detection_async_reviews');
    db.exec('DELETE FROM sec_rule_candidates');
    db.exec('DELETE FROM sec_detection_rules');
    db.exec('DELETE FROM platform_config');
    detectionPipelineService.setAiAnalyzer(null);
  });

  it('keeps a spoofed tenant header out of victim persistence when authentication finally returns 401', async () => {
    const app = express();
    app.use(express.json());
    app.use(apiTrafficShadowMiddleware);
    app.get('/protected', authenticate, (_req, res) => res.status(200).json({ ok: true }));

    const victimEventsBefore = countRows('sec_detection_events', victimTenantId);
    const victimCandidatesBefore = countRows('sec_rule_candidates', victimTenantId);
    const anonymousEventsBefore = countRows('sec_detection_events', ANONYMOUS_TENANT_ID);

    await request(app)
      .get('/protected?probe=tenant-isolation')
      .set('x-request-id', 'tenant-spoof-final-401')
      .set('x-tenant-id', victimTenantId)
      .set('x-api-key', 'key_victim-tenant_unverified')
      .set('authorization', 'Bearer invalid-unverified-token')
      .expect(401)
      .expect((response) => {
        expect(response.body?.code).toBe('AUTH_TOKEN_INVALID');
      });

    expect(countRows('sec_detection_events', victimTenantId)).toBe(victimEventsBefore);
    expect(countRows('sec_rule_candidates', victimTenantId)).toBe(victimCandidatesBefore);
    expect(countRows('sec_detection_events', ANONYMOUS_TENANT_ID)).toBe(anonymousEventsBefore);

    const persisted = getDatabase().prepare(`
      SELECT tenant_id, request_id
      FROM sec_detection_events
      WHERE request_id = ?
    `).get('tenant-spoof-final-401');
    expect(persisted).toBeUndefined();
  });
});
