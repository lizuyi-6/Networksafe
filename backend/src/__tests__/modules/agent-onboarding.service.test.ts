/**
 * SECURITY tests (audit 2026-08, AUD-03-2): agent onboarding code
 * consumption is a single service-owned transaction.
 *
 * - a max_uses=1 code minted N concurrent exchanges creates exactly ONE
 *   agent (the previous route-level read-check-write race could mint N);
 * - a failed exchange never burns a use;
 * - expected_tags is a REAL contract: the exchanging agent must present
 *   every expected tag.
 */

import crypto from 'crypto';
import { initDatabase } from '../../config/database';
import {
  agentOnboardingService
} from '../../modules/agent-onboarding/agent-onboarding.service';
import {
  saveAgentOnboardingCode,
  getAgentOnboardingCodeByHash
} from '../../modules/agent-onboarding/agent-onboarding.repository';
import { ensureAgentOnboardingSchema } from '../../modules/agent-onboarding/agent-onboarding.schema';
import agentAuthService from '../../security/agent-auth.service';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

function hashCode(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function randomCode(): string {
  return `fgob_${crypto.randomBytes(18).toString('base64url')}`;
}

async function seedCode(overrides: Record<string, any> = {}): Promise<string> {
  const raw = randomCode();
  const id = crypto.randomUUID();
  await saveAgentOnboardingCode({
    id,
    code_hash: hashCode(raw),
    tenant_id: 'tenant-onboard-test',
    created_by: 'tester',
    max_uses: 1,
    used_count: 0,
    status: 'active',
    expected_hostname: null,
    expected_tags_json: '[]',
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    used_at: null,
    used_by_agent_id: null,
    ...overrides
  });
  return raw;
}

describe('agentOnboardingService.exchangeOnboardingCode (AUD-03-2)', () => {
  beforeAll(async () => {
    await initDatabase();
    ensureAgentOnboardingSchema();
  });

  it('exchanges a valid code exactly once and records consumption', async () => {
    const raw = await seedCode();

    const result = await agentOnboardingService.exchangeOnboardingCode({
      rawCode: raw,
      hostname: `onboard-a-${Date.now()}.test`,
      platform: 'linux'
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registration.agentId).toBeTruthy();
    expect(result.codeRow.used_count).toBe(1);
    expect(result.codeRow.status).toBe('used');
    expect(result.codeRow.used_by_agent_id).toBe(result.registration.agentId);

    // Second exchange of the same code fails as used.
    const replay = await agentOnboardingService.exchangeOnboardingCode({
      rawCode: raw,
      hostname: `onboard-b-${Date.now()}.test`,
      platform: 'linux'
    });
    expect(replay).toEqual({ ok: false, reason: 'code_used' });
  });

  it('creates exactly ONE agent when 50 exchanges race a max_uses=1 code', async () => {
    const raw = await seedCode({ max_uses: 1 });
    const registerSpy = jest.spyOn(agentAuthService, 'registerAgent');

    const attempts = await Promise.all(Array.from({ length: 50 }, (_, i) =>
      agentOnboardingService.exchangeOnboardingCode({
        rawCode: raw,
        hostname: `race-${Date.now()}-${i}.test`,
        platform: 'linux'
      })
    ));

    const succeeded = attempts.filter((attempt) => attempt.ok);
    expect(succeeded).toHaveLength(1);
    expect(registerSpy).toHaveBeenCalledTimes(1);

    const row = await getAgentOnboardingCodeByHash(hashCode(raw));
    expect(Number(row?.used_count)).toBe(1);
    expect(row?.status).toBe('used');
    registerSpy.mockRestore();
  });

  it('admits exactly max_uses agents for a multi-use code', async () => {
    const raw = await seedCode({ max_uses: 3 });

    const attempts = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      agentOnboardingService.exchangeOnboardingCode({
        rawCode: raw,
        hostname: `multi-${Date.now()}-${i}.test`,
        platform: 'linux'
      })
    ));

    expect(attempts.filter((attempt) => attempt.ok)).toHaveLength(3);
    const row = await getAgentOnboardingCodeByHash(hashCode(raw));
    expect(Number(row?.used_count)).toBe(3);
    expect(row?.status).toBe('used');
  });

  it('does not burn a use when registration fails', async () => {
    const raw = await seedCode();
    const spy = jest.spyOn(agentAuthService, 'registerAgent')
      .mockImplementationOnce(() => { throw new Error('db down'); });

    const failed = await agentOnboardingService.exchangeOnboardingCode({
      rawCode: raw,
      hostname: `fail-${Date.now()}.test`,
      platform: 'linux'
    });
    expect(failed).toEqual({ ok: false, reason: 'registration_failed' });

    // The code is still claimable after the failed attempt.
    const recovered = await agentOnboardingService.exchangeOnboardingCode({
      rawCode: raw,
      hostname: `recover-${Date.now()}.test`,
      platform: 'linux'
    });
    expect(recovered.ok).toBe(true);
    spy.mockRestore();
  });

  it('fails closed on an unparseable expiry', async () => {
    const raw = await seedCode({ expires_at: 'not-a-timestamp' });

    const result = await agentOnboardingService.exchangeOnboardingCode({
      rawCode: raw,
      hostname: `exp-${Date.now()}.test`,
      platform: 'linux'
    });
    expect(result).toEqual({ ok: false, reason: 'code_expired' });
  });

  it('enforces expected_hostname', async () => {
    const raw = await seedCode({ expected_hostname: 'expected-host.test' });

    const mismatch = await agentOnboardingService.exchangeOnboardingCode({
      rawCode: raw,
      hostname: 'other-host.test',
      platform: 'linux'
    });
    expect(mismatch).toEqual({ ok: false, reason: 'hostname_mismatch' });

    const match = await agentOnboardingService.exchangeOnboardingCode({
      rawCode: raw,
      hostname: 'expected-host.test',
      platform: 'linux'
    });
    expect(match.ok).toBe(true);
  });

  it('enforces the expected_tags contract (AUD-03-2: no longer a fake field)', async () => {
    const raw = await seedCode({ expected_tags_json: JSON.stringify(['production', 'dmz']) });

    // Missing tags are rejected.
    const noTags = await agentOnboardingService.exchangeOnboardingCode({
      rawCode: raw,
      hostname: `tags-${Date.now()}.test`,
      platform: 'linux'
    });
    expect(noTags).toEqual({ ok: false, reason: 'tags_mismatch' });

    // Partial coverage is rejected.
    const partial = await agentOnboardingService.exchangeOnboardingCode({
      rawCode: raw,
      hostname: `tags-${Date.now()}.test`,
      platform: 'linux',
      tags: ['production']
    });
    expect(partial).toEqual({ ok: false, reason: 'tags_mismatch' });

    // Presenting ALL expected tags (any case) passes, and the use is burned
    // only on success.
    const satisfied = await agentOnboardingService.exchangeOnboardingCode({
      rawCode: raw,
      hostname: `tags-${Date.now()}.test`,
      platform: 'linux',
      tags: ['DMZ', 'Production', 'extra-tag-is-fine']
    });
    expect(satisfied.ok).toBe(true);
  });

  it('rejects expired and revoked codes', async () => {
    const expired = await seedCode({ expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(await agentOnboardingService.exchangeOnboardingCode({
      rawCode: expired,
      hostname: `exp-${Date.now()}.test`,
      platform: 'linux'
    })).toEqual({ ok: false, reason: 'code_expired' });

    const revoked = await seedCode({ status: 'revoked' });
    expect(await agentOnboardingService.exchangeOnboardingCode({
      rawCode: revoked,
      hostname: `rev-${Date.now()}.test`,
      platform: 'linux'
    })).toEqual({ ok: false, reason: 'code_inactive' });

    expect(await agentOnboardingService.exchangeOnboardingCode({
      rawCode: 'fgob_never_issued',
      hostname: `none-${Date.now()}.test`,
      platform: 'linux'
    })).toEqual({ ok: false, reason: 'code_not_found' });
  });
});
