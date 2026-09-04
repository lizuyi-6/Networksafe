/**
 * Session Transplant Attack Feasibility (red team)
 *
 * Attack model: an admin logs in on machine A (browser). The attacker extracts
 * the accessToken/refreshToken cookie values (disk access to the browser
 * profile, infostealer malware, plain-HTTP MITM, etc. — the extraction step is
 * OUT OF SCOPE here) and replays them from machine B with a different IP and a
 * different User-Agent, driving the API with a script.
 *
 * The question this suite answers: does ANY layer of the current auth chain
 * (JWT signature -> blacklist -> session store -> identity revalidation) bind
 * the session to the machine it was issued on?
 *
 * Verdict encoded below: the session is NOT machine-bound. The deviceInfo
 * (ip, userAgent) captured at login is stored but never compared on subsequent
 * requests, so a transplanted session is fully usable from another host.
 */

import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDatabase, closeDatabase, getDatabase } from '../../config/database';
import authRouter from '../../api/routes/auth.routes';
import {
    authenticate,
    requireRole,
    AuthenticatedRequest
} from '../../middleware/auth.middleware';
import { requireStepUp } from '../../middleware/step-up.middleware';

// --- Machines ---------------------------------------------------------------

const MACHINE_A = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    ip: '10.20.1.50' // admin workstation, LAN
};

const MACHINE_B = {
    userAgent: 'curl/8.9.1',
    ip: '203.0.113.77' // external host running the automation
};

// --- Test app ---------------------------------------------------------------

const app = express();
app.set('trust proxy', true); // honor X-Forwarded-For so the two "machines" get distinct req.ip
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRouter);

// Stand-in for any admin-gated API the automation would target.
app.get('/api/admin/protected-resource', authenticate, requireRole('admin'), requireStepUp, (req, res) => {
    const user = (req as AuthenticatedRequest).user!;
    res.status(200).json({ ok: true, userId: user.userId, role: user.role, email: user.email });
});

function responseCookie(response: request.Response, name: string): string {
    const cookies = (response.headers['set-cookie'] as unknown as string[]) || [];
    const cookie = cookies.find((entry) => entry.startsWith(`${name}=`));
    if (!cookie) {
        throw new Error(`Missing ${name} cookie`);
    }
    return cookie.split(';')[0];
}

function responseCookieValue(response: request.Response, name: string): string {
    const cookie = responseCookie(response, name);
    return decodeURIComponent(cookie.slice(`${name}=`.length));
}

const testDataDir = path.join(os.tmpdir(), 'aetherguard-session-transplant-test');
const originalStepUpEnforcement = process.env.STEPUP_ENFORCEMENT;

async function loginAsAdmin(email: string): Promise<request.Response> {
    return request(app)
        .post('/api/auth/login')
        .set('User-Agent', MACHINE_A.userAgent)
        .set('X-Forwarded-For', MACHINE_A.ip)
        .send({ email, password: 'S3cure-Passw0rd!' });
}

// Replay helpers: machine B never presents machine A's browser fingerprint.
const replayAsMachineB = (req: request.Test) =>
    req.set('User-Agent', MACHINE_B.userAgent).set('X-Forwarded-For', MACHINE_B.ip);

describe('Session transplant attack (admin cookie replayed from another machine)', () => {
    beforeAll(async () => {
        fs.rmSync(testDataDir, { recursive: true, force: true });
        process.env.DATA_DIR = testDataDir;
        process.env.ALLOW_BREAK_GLASS_PASSWORD_LOGIN = 'true';
        process.env.STEPUP_ENFORCEMENT = 'off';
        await initDatabase();
    });

    afterAll(async () => {
        if (originalStepUpEnforcement === undefined) delete process.env.STEPUP_ENFORCEMENT;
        else process.env.STEPUP_ENFORCEMENT = originalStepUpEnforcement;
        closeDatabase();
        fs.rmSync(testDataDir, { recursive: true, force: true });
    });

    let transplantedAccessCookie = '';
    let transplantedRefreshCookie = '';
    let transplantedRefreshValue = '';

    it('machine A: admin logs in normally, session issued with hardened cookie flags', async () => {
        const db = getDatabase();
        const passwordHash = await bcrypt.hash('S3cure-Passw0rd!', 12);
        db.exec(`INSERT INTO users (id, email, username, password_hash, role, plan, tenant_id, status)
                 VALUES ('admin-victim-1', 'victim-admin@example.com', 'Victim Admin', '${passwordHash}', 'admin', 'starter', 'tenant-victim-1', 'active')`);

        const login = await loginAsAdmin('victim-admin@example.com');
        expect(login.status).toBe(200);

        const setCookie = (login.headers['set-cookie'] as unknown as string[]).join('\n').toLowerCase();
        expect(setCookie).toContain('httponly'); // blocks JS theft, not machine-level extraction
        expect(setCookie).toContain('samesite=strict');

        transplantedAccessCookie = responseCookie(login, 'accessToken');
        transplantedRefreshCookie = responseCookie(login, 'refreshToken');
        transplantedRefreshValue = responseCookieValue(login, 'refreshToken');
        expect(transplantedAccessCookie).toMatch(/^accessToken=.+/);
    });

    it('enforcement tripwire: the same transplanted session is blocked on a high-risk operation', async () => {
        process.env.STEPUP_ENFORCEMENT = 'on';
        const response = await replayAsMachineB(
            request(app).get('/api/admin/protected-resource').set('Cookie', `${transplantedAccessCookie}; ${transplantedRefreshCookie}`)
        );
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('STEPUP_ENROLL_REQUIRED');
        process.env.STEPUP_ENFORCEMENT = 'off';
    });
    it('machine B: transplanted cookie grants full admin API access from a different IP and User-Agent', async () => {
        const response = await replayAsMachineB(
            request(app).get('/api/admin/protected-resource').set('Cookie', `${transplantedAccessCookie}; ${transplantedRefreshCookie}`)
        );

        // THE FINDING: when step-up enforcement is off, the legacy auth chain
        // still does not compare the request device against login device.
        expect(response.status).toBe(200);
        expect(response.body.ok).toBe(true);
        expect(response.body.role).toBe('platform_admin'); // normalizeRole('admin')
        expect(response.body.email).toBe('victim-admin@example.com');
    });

    it('machine B: pure automation (no browser) via Authorization: Bearer replay also succeeds', async () => {
        const token = transplantedAccessCookie.slice('accessToken='.length);
        const response = await replayAsMachineB(
            request(app).get('/api/admin/protected-resource').set('Authorization', `Bearer ${token}`)
        );

        expect(response.status).toBe(200);
        expect(response.body.role).toBe('platform_admin');
    });

    it('machine B: the refresh endpoint is equally transplantable and extends the hijack by 7 more days', async () => {
        const response = await replayAsMachineB(
            request(app).post('/api/auth/refresh').set('Cookie', `refreshToken=${transplantedRefreshValue}`)
        );

        expect(response.status).toBe(200);
        const newAccess = responseCookie(response, 'accessToken');
        expect(newAccess).toMatch(/^accessToken=.+/);
    });

    it('control: a tampered cookie is still rejected (the results above come from the real session)', async () => {
        const token = transplantedAccessCookie.slice('accessToken='.length);
        const forged = `accessToken=${token.slice(0, -3)}xyz`;
        const response = await replayAsMachineB(
            request(app).get('/api/admin/protected-resource').set('Cookie', forged)
        );

        expect(response.status).toBe(401);
    });

    it('existing tripwire: refresh tokens are single-use — victim replaying the same token kills the whole session for BOTH sides', async () => {
        // Fresh session so this test owns its refresh token lifecycle.
        const login = await loginAsAdmin('victim-admin@example.com');
        expect(login.status).toBe(200);
        const refreshValue = responseCookieValue(login, 'refreshToken');

        // Attacker refreshes first on machine B: gets new tokens (same sessionId).
        const attackerRefresh = await replayAsMachineB(
            request(app).post('/api/auth/refresh').set('Cookie', `refreshToken=${refreshValue}`)
        );
        expect(attackerRefresh.status).toBe(200);

        // Victim's browser later refreshes with the ORIGINAL token: replay
        // detection fires and revokes the entire session.
        const victimRefresh = await request(app)
            .post('/api/auth/refresh')
            .set('User-Agent', MACHINE_A.userAgent)
            .set('X-Forwarded-For', MACHINE_A.ip)
            .set('Cookie', `refreshToken=${refreshValue}`);
        expect(victimRefresh.status).toBe(401);

        // The revocation is session-wide: even the attacker's freshly minted
        // access token is dead — but only because the victim happened to
        // refresh afterwards. An attacker who never refreshes faces no
        // equivalent tripwire for the 24h access-token window.
        const attackerAccess = responseCookie(attackerRefresh, 'accessToken');
        const afterRevocation = await replayAsMachineB(
            request(app).get('/api/admin/protected-resource').set('Cookie', attackerAccess)
        );
        expect(afterRevocation.status).toBe(401);
    });
});
