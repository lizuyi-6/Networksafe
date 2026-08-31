/**
 * WebAuthn ceremony route contract tests.
 *
 * These tests intentionally stop before invoking a real authenticator: browser
 * ceremony success is covered by the @simplewebauthn/server verification path;
 * the security-critical route contracts (current-password re-authentication,
 * challenge issuance, and enrollment gating) are exercised against the real
 * Express router and session store.
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

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRouter);

const dataDir = path.join(os.tmpdir(), 'aetherguard-webauthn-route-test');
const originalEnv = {
    dataDir: process.env.DATA_DIR,
    allowBreakGlass: process.env.ALLOW_BREAK_GLASS_PASSWORD_LOGIN,
    frontendUrl: process.env.FRONTEND_APP_URL,
    allowedOrigins: process.env.ALLOWED_ORIGINS,
    stepUpEnforcement: process.env.STEPUP_ENFORCEMENT
};

function accessCookie(response: request.Response): string {
    const cookies = (response.headers['set-cookie'] as unknown as string[]) || [];
    const cookie = cookies.find((entry) => entry.startsWith('accessToken='));
    if (!cookie) throw new Error('Missing accessToken cookie');
    return cookie.split(';')[0];
}

function cookieValue(response: request.Response, name: string): string {
    const cookies = (response.headers['set-cookie'] as unknown as string[]) || [];
    const cookie = cookies.find((entry) => entry.startsWith(`${name}=`));
    if (!cookie) throw new Error(`Missing ${name} cookie`);
    return decodeURIComponent(cookie.split(';')[0].slice(name.length + 1));
}

describe('WebAuthn / Passkey route contracts', () => {
    let adminAccessCookie = '';

    beforeAll(async () => {
        fs.rmSync(dataDir, { recursive: true, force: true });
        process.env.DATA_DIR = dataDir;
        process.env.ALLOW_BREAK_GLASS_PASSWORD_LOGIN = 'true';
        process.env.FRONTEND_APP_URL = 'http://localhost:5173';
        process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
        process.env.STEPUP_ENFORCEMENT = 'on';
        await initDatabase();

        const passwordHash = await bcrypt.hash('S3cure-Passw0rd!', 12);
        getDatabase().exec(`
            INSERT INTO users (id, email, username, password_hash, role, plan, tenant_id, status)
            VALUES ('webauthn-admin-1', 'webauthn-admin@example.com', 'WebAuthn Admin', '${passwordHash}', 'admin', 'starter', 'tenant-webauthn-1', 'active')
        `);

        const login = await request(app)
            .post('/api/auth/login')
            .set('User-Agent', 'Mozilla/5.0 WebAuthn Route Test')
            .set('X-Forwarded-For', '10.20.1.50')
            .send({ email: 'webauthn-admin@example.com', password: 'S3cure-Passw0rd!' });
        expect(login.status).toBe(200);
        adminAccessCookie = accessCookie(login);
    });

    afterAll(() => {
        if (originalEnv.dataDir === undefined) delete process.env.DATA_DIR;
        else process.env.DATA_DIR = originalEnv.dataDir;
        if (originalEnv.allowBreakGlass === undefined) delete process.env.ALLOW_BREAK_GLASS_PASSWORD_LOGIN;
        else process.env.ALLOW_BREAK_GLASS_PASSWORD_LOGIN = originalEnv.allowBreakGlass;
        if (originalEnv.frontendUrl === undefined) delete process.env.FRONTEND_APP_URL;
        else process.env.FRONTEND_APP_URL = originalEnv.frontendUrl;
        if (originalEnv.allowedOrigins === undefined) delete process.env.ALLOWED_ORIGINS;
        else process.env.ALLOWED_ORIGINS = originalEnv.allowedOrigins;
        if (originalEnv.stepUpEnforcement === undefined) delete process.env.STEPUP_ENFORCEMENT;
        else process.env.STEPUP_ENFORCEMENT = originalEnv.stepUpEnforcement;
        closeDatabase();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('rejects registration options without a current password', async () => {
        const response = await request(app)
            .post('/api/auth/webauthn/register/options')
            .set('Cookie', adminAccessCookie)
            .send({});

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('WEBAUTHN_REGISTRATION_REAUTH_REQUIRED');
    });

    it('rejects registration options with an incorrect current password', async () => {
        const response = await request(app)
            .post('/api/auth/webauthn/register/options')
            .set('Cookie', adminAccessCookie)
            .send({ currentPassword: 'wrong-password' });

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('WEBAUTHN_REGISTRATION_REAUTH_REQUIRED');
    });

    it('issues registration options only after current-password re-authentication', async () => {
        const response = await request(app)
            .post('/api/auth/webauthn/register/options')
            .set('Cookie', adminAccessCookie)
            .send({ currentPassword: 'S3cure-Passw0rd!' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.challenge).toEqual(expect.any(String));
        expect(response.body.data.rp.id).toBe('localhost');
    });

    it('gates step-up options with STEPUP_ENROLL_REQUIRED until a credential exists', async () => {
        const response = await request(app)
            .post('/api/auth/webauthn/stepup/options')
            .set('Cookie', adminAccessCookie)
            .send({});

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('STEPUP_ENROLL_REQUIRED');
        expect(response.body.message).toBe('backend.stepup_enroll_required');
    });

    it('lists no credentials before registration and never exposes private public-key material', async () => {
        const response = await request(app)
            .get('/api/auth/webauthn/credentials')
            .set('Cookie', adminAccessCookie);

        expect(response.status).toBe(200);
        expect(response.body.data.credentials).toEqual([]);
        expect(response.body.data.publicKey).toBeUndefined();
    });

    it('does not accept a registration verification response without a live challenge', async () => {
        const freshLogin = await request(app)
            .post('/api/auth/login')
            .set('User-Agent', 'Mozilla/5.0 WebAuthn Fresh Session')
            .set('X-Forwarded-For', '10.20.1.51')
            .send({ email: 'webauthn-admin@example.com', password: 'S3cure-Passw0rd!' });
        const response = await request(app)
            .post('/api/auth/webauthn/register/verify')
            .set('Cookie', accessCookie(freshLogin))
            .send({
                currentPassword: 'S3cure-Passw0rd!',
                response: { id: 'not-a-real-credential' }
            });

        expect(response.status).toBe(401);
        expect(response.body.code).toBe('WEBAUTHN_CHALLENGE_INVALID');
    });

    it('keeps the refresh token httpOnly and separate from ceremony payloads', async () => {
        const login = await request(app)
            .post('/api/auth/login')
            .set('User-Agent', 'Mozilla/5.0 WebAuthn Route Test')
            .set('X-Forwarded-For', '10.20.1.50')
            .send({ email: 'webauthn-admin@example.com', password: 'S3cure-Passw0rd!' });
        expect(cookieValue(login, 'refreshToken')).toEqual(expect.any(String));
        expect(login.body.data?.refreshToken).toBeUndefined();
        expect(login.body.refreshToken).toBeUndefined();
    });
});
