/**
 * Authentication API Integration Tests
 * 
 * Tests for user registration, login, and token management
 */

import request from 'supertest';
import express from 'express';
import { initDatabase, closeDatabase, getDatabase } from '../config/database';
import authRouter from '../api/routes/auth.routes';

// Create test app
const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

describe('Authentication API', () => {
    beforeAll(async () => {
        // Initialize test database
        process.env.DATA_DIR = './test-data';
        await initDatabase();
    });

    afterAll(async () => {
        closeDatabase();
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
            expect(response.body.message).toBe('User registered successfully');
            expect(response.body.user).toBeDefined();
            expect(response.body.user.email).toBe('test@example.com');
            expect(response.body.accessToken).toBeDefined();
            expect(response.body.refreshToken).toBeDefined();
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
            expect(response.body.message).toBe('Login successful');
            expect(response.body.user).toBeDefined();
            expect(response.body.accessToken).toBeDefined();
            expect(response.body.refreshToken).toBeDefined();
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

            accessToken = registerResponse.body.accessToken;
        });

        it('should return current user info with valid token', async () => {
            const response = await request(app)
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${accessToken}`);

            expect(response.status).toBe(200);
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
    });

    describe('POST /api/auth/refresh', () => {
        let refreshToken: string;

        beforeEach(async () => {
            const registerResponse = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'refresh-test@example.com',
                    password: 'password123',
                    username: 'Refresh Test User'
                });

            refreshToken = registerResponse.body.refreshToken;
        });

        it('should refresh tokens with valid refresh token', async () => {
            const response = await request(app)
                .post('/api/auth/refresh')
                .send({ refreshToken });

            expect(response.status).toBe(200);
            expect(response.body.message).toBe('Token refreshed');
            expect(response.body.accessToken).toBeDefined();
            expect(response.body.refreshToken).toBeDefined();
        });

        it('should reject refresh with invalid token', async () => {
            const response = await request(app)
                .post('/api/auth/refresh')
                .send({ refreshToken: 'invalid-refresh-token' });

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
    });

    describe('POST /api/auth/logout', () => {
        let accessToken: string;

        beforeEach(async () => {
            const registerResponse = await request(app)
                .post('/api/auth/register')
                .send({
                    email: 'logout-test@example.com',
                    password: 'password123',
                    username: 'Logout Test User'
                });

            accessToken = registerResponse.body.accessToken;
        });

        it('should logout successfully with valid token', async () => {
            const response = await request(app)
                .post('/api/auth/logout')
                .set('Authorization', `Bearer ${accessToken}`);

            expect(response.status).toBe(200);
            expect(response.body.message).toBe('Logout successful');
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

            accessToken = registerResponse.body.accessToken;
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
            expect(response.body.message).toBe('Password changed successfully');

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
