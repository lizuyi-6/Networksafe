/**
 * Authentication API Integration Tests
 * 
 * Tests for user registration, login, and token management
 */

import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import os from 'os';
import path from 'path';
import jwt from 'jsonwebtoken';
import { initDatabase, closeDatabase, getDatabase } from '../config/database';
import authRouter from '../api/routes/auth.routes';
import authSecurityService from '../security/auth-security.service';

// Create test app
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRouter);

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

const testDataDir = path.join(os.tmpdir(), 'aetherguard-auth-test-data');

describe('Authentication API', () => {
    beforeAll(async () => {
        // Initialize test database
        fs.rmSync(testDataDir, { recursive: true, force: true });
        process.env.DATA_DIR = testDataDir;
        // The login route refuses password login unless the runtime is
        // in lab mode OR ALLOW_BREAK_GLASS_PASSWORD_LOGIN is set. Tests
        // exercise the password path directly, so opt in here.
        process.env.ALLOW_BREAK_GLASS_PASSWORD_LOGIN = 'true';
        await initDatabase();
    });

    afterAll(async () => {
        closeDatabase();
        fs.rmSync(testDataDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        // Clean up users table before each test
        const db = getDatabase();
        db.exec('DELETE FROM users WHERE email LIKE \'%test%\'');
    });

    describe('POST /api/auth/register', () => {
        it('should register a new user successfully', async () => {
            const response = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'test@example.com',
                    password: 'password123',
                    username: 'Test User'
                });

            expect(response.status).toBe(201);
            expect(response.body.message).toBe('backend.user_registered_successfully');
            expect(response.body.user).toBeDefined();
            expect(response.body.user.email).toBe('test@example.com');
            expect(response.body.accessToken).toBeUndefined();
            expect(response.body.refreshToken).toBeUndefined();
            expect(response.body.data?.accessToken).toBeUndefined();
            expect(response.body.data?.refreshToken).toBeUndefined();
            expect(responseCookie(response, 'accessToken')).toMatch(/^accessToken=.+/);
            expect(responseCookie(response, 'refreshToken')).toMatch(/^refreshToken=.+/);
        });

        it('should reject registration with missing email', async () => {
            const response = await request(app)
                .post('/api/auth/register')
                .send({
                    password: 'password123',
                    username: 'Test User'
                });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('VALIDATION_ERROR');
        });

        it('should reject registration with missing password', async () => {
            const response = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'test2@example.com',
                    username: 'Test User'
                });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('VALIDATION_ERROR');
        });

        it('should reject registration with invalid email format', async () => {
            const response = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'invalid-email',
                    password: 'password123',
                    username: 'Test User'
                });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('INVALID_EMAIL');
        });

        it('should reject registration with short password', async () => {
            const response = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'test3@example.com',
                    password: '123',
                    username: 'Test User'
                });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('PASSWORD_TOO_SHORT');
        });

        it('should reject duplicate email registration', async () => {
            // Register first user
            await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'duplicate-test@example.com',
                    password: 'password123',
                    username: 'First User'
                });

            // Try to register with same email
            const response = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'duplicate-test@example.com',
                    password: 'password456',
                    username: 'Second User'
                });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USER_EXISTS');
        });
    });

    describe('POST /api/auth/login', () => {
        beforeEach(async () => {
            // Create a test user for login tests
            await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'login-test@example.com',
                    password: 'correctpassword',
                    username: 'Login Test User'
                });
        });

        it('should login successfully with correct credentials', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'login-test@example.com',
                    password: 'correctpassword'
                });

            expect(response.status).toBe(200);
            expect(response.body.message).toBe('backend.login_successful');
            expect(response.body.user).toBeDefined();
            expect(response.body.accessToken).toBeUndefined();
            expect(response.body.refreshToken).toBeUndefined();
            expect(response.body.data?.accessToken).toBeUndefined();
            expect(response.body.data?.refreshToken).toBeUndefined();
            expect(responseCookie(response, 'accessToken')).toMatch(/^accessToken=.+/);
            expect(responseCookie(response, 'refreshToken')).toMatch(/^refreshToken=.+/);
        });

        it('should reject login with wrong password', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'login-test@example.com',
                    password: 'wrongpassword'
                });

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('INVALID_CREDENTIALS');
        });

        it('should reject login with non-existent email', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'nonexistent@example.com',
                    password: 'anypassword'
                });

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('INVALID_CREDENTIALS');
        });

        it('should reject login with missing credentials', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({});

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('VALIDATION_ERROR');
        });

        it.each(['pending', 'suspended'])('should reject a %s user with valid credentials', async (status) => {
            getDatabase().prepare('UPDATE users SET status = ? WHERE email = ?')
                .run(status, 'login-test@example.com');

            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'login-test@example.com',
                    password: 'correctpassword'
                });

            expect(response.status).toBe(403);
            expect(response.body.code).toBe('ACCOUNT_NOT_ACTIVE');
        });

        it('should not disclose inactive account state to a caller with the wrong password', async () => {
            getDatabase().prepare('UPDATE users SET status = ? WHERE email = ?')
                .run('suspended', 'login-test@example.com');

            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'login-test@example.com',
                    password: 'wrongpassword'
                });

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('INVALID_CREDENTIALS');
        });
    });

    describe('GET /api/auth/me', () => {
        let accessToken: string;

        beforeEach(async () => {
            // Create user and get token
            const registerResponse = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'me-test@example.com',
                    password: 'password123',
                    username: 'Me Test User'
                });

            accessToken = responseCookieValue(registerResponse, 'accessToken');
        });

        it('should return current user info with valid token', async () => {
            const response = await request(app)
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${accessToken}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.user).toBeDefined();
            expect(response.body.user).toBeDefined();
            expect(response.body.user.email).toBe('me-test@example.com');
        });

        it('should reject request without token', async () => {
            const response = await request(app)
                .get('/api/auth/me');

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('AUTH_TOKEN_MISSING');
        });

        it('should reject request with invalid token', async () => {
            const response = await request(app)
                .get('/api/auth/me')
                .set('Authorization', 'Bearer invalid-token');

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('AUTH_TOKEN_INVALID');
        });

        it('should reject an existing token after the user is suspended', async () => {
            getDatabase().prepare('UPDATE users SET status = ? WHERE email = ?')
                .run('suspended', 'me-test@example.com');

            const response = await request(app)
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${accessToken}`);

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('AUTH_TOKEN_INVALID');
        });

        it('should reject an existing token after the user role changes', async () => {
            getDatabase().prepare('UPDATE users SET role = ? WHERE email = ?')
                .run('viewer', 'me-test@example.com');

            const response = await request(app)
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${accessToken}`);

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('AUTH_TOKEN_INVALID');
        });

        it('should reject an existing token after the user tenant changes', async () => {
            getDatabase().prepare('UPDATE users SET tenant_id = ? WHERE email = ?')
                .run('tenant-after-transfer', 'me-test@example.com');

            const response = await request(app)
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${accessToken}`);

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('AUTH_TOKEN_INVALID');
        });
    });

    describe('POST /api/auth/refresh', () => {
        let refreshToken: string;
        let refreshCookie: string;

        beforeEach(async () => {
            const registerResponse = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'refresh-test@example.com',
                    password: 'password123',
                    username: 'Refresh Test User'
                });

            refreshToken = responseCookieValue(registerResponse, 'refreshToken');
            refreshCookie = responseCookie(registerResponse, 'refreshToken');
        });

        it('should refresh tokens with valid refresh token', async () => {
            const response = await request(app)
                .post('/api/auth/refresh')
                .set('Cookie', [refreshCookie]);

            expect(response.status).toBe(200);
            expect(response.body.message).toBe('backend.token_refreshed');
            expect(response.body.accessToken).toBeUndefined();
            expect(response.body.refreshToken).toBeUndefined();
            expect(responseCookie(response, 'accessToken')).toMatch(/^accessToken=.+/);
            expect(responseCookie(response, 'refreshToken')).not.toBe(refreshCookie);
        });

        it('allows exactly one of two concurrent uses of the same refresh token', async () => {
            const [first, second] = await Promise.all([
                request(app).post('/api/auth/refresh').set('Cookie', [refreshCookie]),
                request(app).post('/api/auth/refresh').set('Cookie', [refreshCookie])
            ]);
            const responses = [first, second];

            expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
            expect(responses.find((response) => response.status === 401)?.body.code).toBe('TOKEN_INVALIDATED');
            const successful = responses.find((response) => response.status === 200)!;
            expect(successful.body.refreshToken).toBeUndefined();
            expect(responseCookie(successful, 'refreshToken')).not.toBe(refreshCookie);
        });

        it('should reject refresh with invalid token', async () => {
            const response = await request(app)
                .post('/api/auth/refresh')
                .set('Cookie', ['refreshToken=invalid-refresh-token']);

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('TOKEN_INVALID');
        });

        it('should reject refresh without token', async () => {
            const response = await request(app)
                .post('/api/auth/refresh')
                .send({});

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('TOKEN_MISSING');
        });

        it('should reject a refresh token supplied only in the request body', async () => {
            const response = await request(app)
                .post('/api/auth/refresh')
                .send({ refreshToken });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('TOKEN_MISSING');
        });

        it('should reject refresh when its tracked session has been removed', async () => {
            const decoded = jwt.decode(refreshToken) as jwt.JwtPayload;
            expect(typeof decoded.userId).toBe('string');
            expect(typeof decoded.sessionId).toBe('string');
            await expect(authSecurityService.removeSession(decoded.userId, decoded.sessionId)).resolves.toBe(true);

            const response = await request(app)
                .post('/api/auth/refresh')
                .set('Cookie', [refreshCookie]);

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('SESSION_INVALID');
        });

        it.each(['pending', 'suspended'])('should reject refresh for a %s user', async (status) => {
            getDatabase().prepare('UPDATE users SET status = ? WHERE email = ?')
                .run(status, 'refresh-test@example.com');

            const response = await request(app)
                .post('/api/auth/refresh')
                .set('Cookie', [refreshCookie]);

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('USER_INVALID');
        });
    });

    describe('POST /api/auth/logout', () => {
        let accessToken: string;
        let refreshToken: string;

        beforeEach(async () => {
            const registerResponse = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'logout-test@example.com',
                    password: 'password123',
                    username: 'Logout Test User'
                });

            accessToken = responseCookieValue(registerResponse, 'accessToken');
            refreshToken = responseCookieValue(registerResponse, 'refreshToken');
        });

        it('should logout successfully with valid token', async () => {
            const response = await request(app)
                .post('/api/auth/logout')
                .set('Authorization', `Bearer ${accessToken}`);

            expect(response.status).toBe(200);
            expect(response.body.message).toBe('backend.logout_successful');

            const accessAfterLogout = await request(app)
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${accessToken}`);
            expect(accessAfterLogout.status).toBe(401);
            expect(accessAfterLogout.body.code).toBe('AUTH_TOKEN_INVALID');

            const refreshAfterLogout = await request(app)
                .post('/api/auth/refresh')
                .set('Cookie', [`refreshToken=${refreshToken}`]);
            expect(refreshAfterLogout.status).toBe(401);
            expect(refreshAfterLogout.body.code).toBe('SESSION_INVALID');
        });

        it('should revoke only the current session and preserve another active login', async () => {
            const secondLogin = await request(app)
                .post('/api/auth/login')
                .send({ email: 'logout-test@example.com', password: 'password123' });
            expect(secondLogin.status).toBe(200);
            const secondAccessToken = responseCookieValue(secondLogin, 'accessToken');

            const logoutResponse = await request(app)
                .post('/api/auth/logout')
                .set('Authorization', `Bearer ${accessToken}`);
            expect(logoutResponse.status).toBe(200);

            const secondSessionResponse = await request(app)
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${secondAccessToken}`);
            expect(secondSessionResponse.status).toBe(200);
            expect(secondSessionResponse.body.user.email).toBe('logout-test@example.com');
        });

        it('should reject logout without token', async () => {
            const response = await request(app)
                .post('/api/auth/logout');

            expect(response.status).toBe(401);
        });
    });

    describe('PUT /api/auth/password', () => {
        let accessToken: string;

        beforeEach(async () => {
            const registerResponse = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'password-test@example.com',
                    password: 'oldpassword123',
                    username: 'Password Test User'
                });

            accessToken = responseCookieValue(registerResponse, 'accessToken');
        });

        it('should change password with correct current password', async () => {
            const response = await request(app)
                .put('/api/auth/password')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({
                    currentPassword: 'oldpassword123',
                    newPassword: 'newpassword456'
                });

            expect(response.status).toBe(200);
            expect(response.body.message).toBe('backend.password_changed_successfully');

            const oldSessionResponse = await request(app)
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${accessToken}`);
            expect(oldSessionResponse.status).toBe(401);
            expect(oldSessionResponse.body.code).toBe('AUTH_TOKEN_INVALID');

            // Verify new password works
            const loginResponse = await request(app)
                .post('/api/auth/login')
                .send({
                    email: 'password-test@example.com',
                    password: 'newpassword456'
                });

            expect(loginResponse.status).toBe(200);
        });

        it('should reject password change with wrong current password', async () => {
            const response = await request(app)
                .put('/api/auth/password')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({
                    currentPassword: 'wrongpassword',
                    newPassword: 'newpassword456'
                });

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('INVALID_PASSWORD');
        });

        it('should reject password change with short new password', async () => {
            const response = await request(app)
                .put('/api/auth/password')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({
                    currentPassword: 'oldpassword123',
                    newPassword: '123'
                });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('PASSWORD_TOO_SHORT');
        });
    });
});
