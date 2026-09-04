/**
 * Agent Onboarding Service (AUD-03-2).
 *
 * Owns the ENTIRE onboarding-code consumption flow in ONE place:
 *   claim code (atomic) -> validate expiry/maxUses/hostname/tags ->
 *   register agent -> finalize consumption — all inside a single
 *   service-owned transaction on the SQLite baseline, and via a single
 *   conditional UPDATE (rowCount-verified) on the Postgres path.
 *
 * SECURITY (audit 2026-08): the previous route-level flow was a
 * non-atomic read-check-register-write sequence: two concurrent exchanges
 * of a max_uses=1 code could both pass the used_count check and mint two
 * agents. `expected_tags_json` was stored but never validated (a fake
 * contract); it is now enforced: an agent presenting a code with expected
 * tags MUST present all of them.
 */

import crypto from 'crypto';
import { getDatabase } from '../../config/database';
import { getDatabaseMode } from '../../config/platform-runtime';
import {
    getAgentOnboardingCodeByHash,
    type AgentOnboardingCodeRow
} from './agent-onboarding.repository';
import { postgresShadowStoreService } from '../../services/postgres-shadow-store.service';
import agentAuthService, {
    type AgentRegistration
} from '../../security/agent-auth.service';

export interface OnboardingExchangeInput {
    rawCode: string;
    hostname: string;
    platform: string;
    mac?: string;
    /** Tags the exchanging agent asserts; must cover the code's expected tags. */
    tags?: string[];
}

export type OnboardingExchangeFailure =
    | 'code_not_found'
    | 'code_inactive'
    | 'code_expired'
    | 'code_used'
    | 'hostname_mismatch'
    | 'tags_mismatch'
    | 'registration_failed';

export type OnboardingExchangeResult =
    | { ok: true; registration: AgentRegistration; codeRow: AgentOnboardingCodeRow }
    | { ok: false; reason: OnboardingExchangeFailure };

/**
 * Internal control flow: a claim must be rolled back, not committed, when
 * the exchange aborts mid-transaction — so aborts are thrown and mapped
 * back to a failure result OUTSIDE the transaction boundary.
 */
class ClaimAborted extends Error {
    constructor(public readonly reason: OnboardingExchangeFailure) {
        super(`onboarding claim aborted: ${reason}`);
    }
}

function hashCode(rawCode: string): string {
    return crypto.createHash('sha256').update(rawCode).digest('hex');
}

function normalizeTags(tags: unknown): string[] {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags
        .map((tag) => String(tag ?? '').trim().toLowerCase())
        .filter((tag) => tag.length > 0)
        .slice(0, 10);
}

function tagsSatisfied(row: AgentOnboardingCodeRow, presented: string[]): boolean {
    let expected: string[] = [];
    try {
        const parsed = JSON.parse(String(row.expected_tags_json || '[]'));
        if (Array.isArray(parsed)) {
            expected = parsed.map((tag) => String(tag ?? '').trim().toLowerCase()).filter(Boolean);
        }
    } catch {
        expected = [];
    }
    if (expected.length === 0) {
        return true;
    }
    const presentedSet = new Set(presented);
    return expected.every((tag) => presentedSet.has(tag));
}

function isExpired(row: AgentOnboardingCodeRow, nowMs: number): boolean {
    const expiresMs = new Date(row.expires_at).getTime();
    // Unparseable expiry fails closed.
    return !Number.isFinite(expiresMs) || expiresMs <= nowMs;
}

export class AgentOnboardingService {
    /**
     * Atomic code consumption + agent registration.
     *
     * SQLite baseline: the whole sequence runs in ONE transaction. The
     * claim is a conditional UPDATE (`status='active' AND used_count <
     * max_uses AND expires_at > now`), verified by reading the row back
     * and comparing used_count — the db wrapper exposes no affected-row
     * count. A lost claim (or any failure) rolls the transaction back, so
     * a failed exchange can never consume a use or leave a partial agent.
     *
     * Postgres path: a single conditional UPDATE whose rowCount proves the
     * claim; the agent registration that follows is best-effort undone
     * (claim decrement) if it throws — the authoritative Postgres primary
     * migration is tracked separately.
     */
    async exchangeOnboardingCode(input: OnboardingExchangeInput): Promise<OnboardingExchangeResult> {
        const codeHash = hashCode(input.rawCode);
        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();

        if (getDatabaseMode() === 'postgres') {
            return this.exchangePostgres(codeHash, input, nowIso);
        }
        return this.exchangeSqlite(codeHash, input, nowMs, nowIso);
    }

    private async exchangeSqlite(
        codeHash: string,
        input: OnboardingExchangeInput,
        nowMs: number,
        nowIso: string
    ): Promise<OnboardingExchangeResult> {
        const result = this.runClaimTransaction(codeHash, input, nowMs, nowIso);
        return result;
    }

    private runClaimTransaction(
        codeHash: string,
        input: OnboardingExchangeInput,
        nowMs: number,
        nowIso: string
    ): OnboardingExchangeResult {
        let registration: AgentRegistration | null = null;
        let outcome: OnboardingExchangeResult;
        try {
            outcome = getDatabase().transaction((): OnboardingExchangeResult => {
            const row = getDatabase().prepare(`
                SELECT *
                FROM agent_onboarding_codes
                WHERE code_hash = ?
                LIMIT 1
            `).get(codeHash) as AgentOnboardingCodeRow | undefined;

            const check = this.checkClaimable(row, input, nowMs);
            if (check) {
                return { ok: false, reason: check };
            }
            const claimable = row as AgentOnboardingCodeRow;
            const prevUsed = Number(claimable.used_count || 0);
            const maxUses = Number(claimable.max_uses || 1);

            // Atomic claim. The WHERE clause is the guard; the read-back
            // (used_count === prevUsed + 1) proves THIS exchange won it.
            getDatabase().prepare(`
                UPDATE agent_onboarding_codes
                SET used_count = used_count + 1,
                    used_at = ?,
                    used_by_agent_id = ?,
                    status = CASE WHEN used_count + 1 >= max_uses THEN 'used' ELSE 'active' END
                WHERE id = ?
                  AND status = 'active'
                  AND used_count < max_uses
                  AND expires_at > ?
            `).run(nowIso, null, claimable.id, nowIso);

            const claimedRow = getDatabase().prepare(`
                SELECT used_count, status
                FROM agent_onboarding_codes
                WHERE id = ?
            `).get(claimable.id) as { used_count?: number; status?: string } | undefined;
            if (!claimedRow || Number(claimedRow.used_count) !== prevUsed + 1) {
                // Lost the claim — roll the transaction back.
                throw new ClaimAborted('code_used');
            }

            try {
                registration = agentAuthService.registerAgent({
                    hostname: input.hostname,
                    platform: input.platform,
                    mac: input.mac,
                    tenantId: claimable.tenant_id || undefined
                });
            } catch {
                // Roll back the claim: a failed exchange must not burn a use.
                throw new ClaimAborted('registration_failed');
            }

            // Bind the registering agent to the consumption record; finalize
            // status in the same transaction.
            getDatabase().prepare(`
                UPDATE agent_onboarding_codes
                SET used_by_agent_id = ?,
                    status = CASE WHEN used_count >= max_uses THEN 'used' ELSE 'active' END
                WHERE id = ?
            `).run(registration.agentId, claimable.id);

            const finalized = getDatabase().prepare(`
                SELECT * FROM agent_onboarding_codes WHERE id = ?
            `).get(claimable.id) as AgentOnboardingCodeRow;

            outcome = { ok: true, registration, codeRow: finalized };
            return outcome;
            });

        } catch (error) {
            if (error instanceof ClaimAborted) {
                return { ok: false, reason: error.reason };
            }
            throw error;
        }
        if (!outcome.ok) {
            registration = null;
        }
        return outcome;
    }

    private async exchangePostgres(
        codeHash: string,
        input: OnboardingExchangeInput,
        nowIso: string
    ): Promise<OnboardingExchangeResult> {
        const row = await getAgentOnboardingCodeByHash(codeHash);
        const check = this.checkClaimable(row ?? undefined, input, Date.now());
        if (check) {
            return { ok: false, reason: check };
        }
        const claimable = row as AgentOnboardingCodeRow;

        // Conditional claim; rowCount proves success (AUD-03-2 contract).
        const claimed = await postgresShadowStoreService.execute(`
            UPDATE agent_onboarding_codes
            SET used_count = used_count + 1,
                used_at = $2,
                status = CASE WHEN used_count + 1 >= max_uses THEN 'used' ELSE 'active' END
            WHERE id = $1
              AND status = 'active'
              AND used_count < max_uses
              AND expires_at > $3
        `, [claimable.id, nowIso, nowIso]);
        if (Number(claimed) !== 1) {
            return { ok: false, reason: 'code_used' };
        }

        let registration: AgentRegistration;
        try {
            registration = agentAuthService.registerAgent({
                hostname: input.hostname,
                platform: input.platform,
                mac: input.mac,
                tenantId: claimable.tenant_id || undefined
            });
        } catch {
            // Undo the claim so the use is not burned by a failed exchange.
            await postgresShadowStoreService.execute(`
                UPDATE agent_onboarding_codes
                SET used_count = MAX(used_count - 1, 0),
                    status = CASE WHEN status = 'used' AND used_count - 1 < max_uses THEN 'active' ELSE status END
                WHERE id = $1
            `, [claimable.id]).catch(() => undefined);
            return { ok: false, reason: 'registration_failed' };
        }

        await postgresShadowStoreService.execute(`
            UPDATE agent_onboarding_codes SET used_by_agent_id = $2 WHERE id = $1
        `, [claimable.id, registration.agentId]).catch(() => undefined);

        const finalized = await getAgentOnboardingCodeByHash(codeHash);
        return { ok: true, registration, codeRow: finalized ?? claimable };
    }

    /**
     * Shared claim-time validation. Returns a failure reason or null when
     * the row is claimable by THIS exchange.
     */
    private checkClaimable(
        row: AgentOnboardingCodeRow | undefined,
        input: OnboardingExchangeInput,
        nowMs: number
    ): OnboardingExchangeFailure | null {
        if (!row) {
            return 'code_not_found';
        }
        // A fully-consumed code reports 'used' (not 'inactive') even though
        // its status column has moved on.
        if (Number(row.used_count || 0) >= Number(row.max_uses || 1)) {
            return 'code_used';
        }
        if (row.status !== 'active') {
            return 'code_inactive';
        }
        if (isExpired(row, nowMs)) {
            return 'code_expired';
        }
        if (row.expected_hostname && row.expected_hostname !== input.hostname) {
            return 'hostname_mismatch';
        }
        if (!tagsSatisfied(row, normalizeTags(input.tags))) {
            return 'tags_mismatch';
        }
        return null;
    }
}

export const agentOnboardingService = new AgentOnboardingService();
