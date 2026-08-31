import type { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDatabase, closeDatabase } from '../../config/database';
import auditLogger from '../../security/audit-logger.service';
import authSecurityService from '../../security/auth-security.service';
import { webauthnService } from '../../services/webauthn.service';
import stepUpService, { isDeviceElevated } from '../../security/step-up.service';
import { requireStepUp } from '../../middleware/step-up.middleware';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware';

const dataDir = path.join(os.tmpdir(), 'aetherguard-step-up-middleware-test');
const originalEnforcement = process.env.STEPUP_ENFORCEMENT;

function makeResponse() {
    const response = {
        status: jest.fn(),
        json: jest.fn()
    } as unknown as Response & { status: jest.Mock; json: jest.Mock };
    response.status.mockReturnValue(response);
    response.json.mockReturnValue(response);
    return response;
}

function makeRequest(input: {
    userId: string;
    sessionId: string;
    ip?: string;
    userAgent?: string;
    cookies?: Record<string, string>;
}): AuthenticatedRequest {
    return {
        ip: input.ip || '10.20.1.50',
        headers: { 'user-agent': input.userAgent || 'Mozilla/5.0 AetherGuardTest' },
        cookies: input.cookies || {},
        user: {
            userId: input.userId,
            email: `${input.userId}@example.com`,
            username: input.userId,
            role: 'admin',
            sessionId: input.sessionId
        }
    } as AuthenticatedRequest;
}

async function callMiddleware(req: AuthenticatedRequest) {
    const res = makeResponse();
    const next = jest.fn() as NextFunction;
    await requireStepUp(req as Request, res, next);
    return { res, next };
}

describe('requireStepUp', () => {
    beforeAll(async () => {
        fs.rmSync(dataDir, { recursive: true, force: true });
        process.env.DATA_DIR = dataDir;
        process.env.STEPUP_ENFORCEMENT = 'off';
        await initDatabase();
        auditLogger.prepare();
        webauthnService.prepare();
    });

    afterAll(() => {
        if (originalEnforcement === undefined) delete process.env.STEPUP_ENFORCEMENT;
        else process.env.STEPUP_ENFORCEMENT = originalEnforcement;
        closeDatabase();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('bypasses step-up when enforcement is explicitly off', async () => {
        process.env.STEPUP_ENFORCEMENT = 'off';
        const { next, res } = await callMiddleware(makeRequest({ userId: 'off-user', sessionId: 'off-session' }));
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('fails closed with STEPUP_ENROLL_REQUIRED when enforcement is on and no Passkey exists', async () => {
        process.env.STEPUP_ENFORCEMENT = 'on';
        const userId = 'enroll-user';
        const sessionId = 'enroll-session';
        await authSecurityService.addSession(userId, sessionId, {
            ip: '10.20.1.50',
            userAgent: 'Mozilla/5.0 AetherGuardTest'
        });

        const { next, res } = await callMiddleware(makeRequest({ userId, sessionId }));
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'STEPUP_ENROLL_REQUIRED',
            message: 'backend.stepup_enroll_required'
        }));
    });

    it('accepts a token only on the device that completed the assertion', async () => {
        process.env.STEPUP_ENFORCEMENT = 'on';
        const userId = 'bound-user';
        const sessionId = 'bound-session';
        const device = { ip: '10.20.1.50', userAgent: 'Mozilla/5.0 AetherGuardTest' };
        await authSecurityService.addSession(userId, sessionId, device);
        webauthnService.saveCredential({
            id: 'bound-credential',
            userId,
            publicKey: Buffer.from('public-key').toString('base64url'),
            counter: 0
        });
        const token = await stepUpService.issueToken(userId, sessionId, device);

        const sameDevice = await callMiddleware(makeRequest({
            userId,
            sessionId,
            ip: device.ip,
            userAgent: device.userAgent,
            cookies: { stepUpToken: token }
        }));
        expect(sameDevice.next).toHaveBeenCalledTimes(1);

        const transplanted = await callMiddleware(makeRequest({
            userId,
            sessionId,
            ip: '203.0.113.77',
            userAgent: 'curl/8.9.1',
            cookies: { stepUpToken: token }
        }));
        expect(transplanted.next).not.toHaveBeenCalled();
        expect(transplanted.res.status).toHaveBeenCalledWith(403);
        expect(transplanted.res.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'STEPUP_REQUIRED',
            message: 'backend.stepup_required'
        }));
        expect(await stepUpService.validateToken(token, userId, sessionId, device)).toBe(false);
    });

    it('treats a different User-Agent as risk elevation even when IP is unchanged', () => {
        const req = makeRequest({ userId: 'ua-user', sessionId: 'ua-session', ip: '10.20.1.50', userAgent: 'curl/8.9.1' });
        expect(isDeviceElevated({ ip: '10.20.1.50', userAgent: 'Mozilla/5.0 AetherGuardTest' }, req)).toBe(true);
    });
});
