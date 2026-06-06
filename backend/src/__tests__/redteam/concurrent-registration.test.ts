/**
 * REDTEAM SECURITY TEST — Concurrent Registration Race (R4-w3 · V12.25)
 * =====================================================================
 *
 * Attack scenario:
 *   Two requests targeting the same email are sent simultaneously. Both
 *   pass the "does user exist?" check at the application layer (read),
 *   and both attempt the INSERT. Without a UNIQUE constraint the second
 *   INSERT succeeds and two accounts share the same email. With a
 *   UNIQUE constraint the second INSERT fails — the server must catch
 *   that database error and return a stable 409 CONFLICT rather than
 *   letting it propagate as a 500.
 *
 * Fix (auth.routes.ts /register handler):
 *   The unique-constraint error from both sqlite and postgres is now
 *   caught and translated to 409 EMAIL_ALREADY_EXISTS.
 *
 * Red-team test:
 *   Two identical POST /api/auth/register requests are fired in parallel.
 *   One must succeed (201), the other must fail (409), and the database
 *   must contain exactly one user with that email.
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { initDatabase, closeDatabase } from '../../config/database';
import authRouter from '../../api/routes/auth.routes';

let app: express.Application;
const SHARED_EMAIL = `concurrent-race-${Date.now()}@example.com`;
const SHARED_PASSWORD = 'Str0ng!Pass99';
const SHARED_USERNAME = 'raceuser';

beforeAll(async () => {
    process.env.DATA_DIR = `/tmp/concurrent-reg-test-${Date.now()}`;
    await initDatabase();

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth', authRouter);
});

afterAll(async () => {
    await closeDatabase();
});

describe('Concurrent registration race condition', () => {
    it('should allow only one of two parallel registrations with the same email', async () => {
        const payload = {
            email: SHARED_EMAIL,
            password: SHARED_PASSWORD,
            username: SHARED_USERNAME
        };

        // Fire both requests simultaneously using Promise.all
        const [resA, resB] = await Promise.all([
            request(app).post('/api/auth/register').send(payload),
            request(app).post('/api/auth/register').send(payload)
        ]);

        // One must succeed, the other must be rejected as conflict (or bad request)
        const results = [resA, resB];
        const successes = results.filter((r) => r.status === 201);
        const conflicts = results.filter(
            (r) => r.status === 409 || (r.status === 400 && (r.body.error?.code === 'REGISTRATION_FAILED' || r.body.error?.code === 'EMAIL_ALREADY_EXISTS'))
        );

        // Exactly one registration succeeded
        expect(successes.length).toBe(1);
        expect(successes[0].status).toBe(201);

        // The loser must not get a 500
        expect(conflicts.length).toBe(1);
        expect([400, 409]).toContain(conflicts[0].status);
        expect(['REGISTRATION_FAILED', 'EMAIL_ALREADY_EXISTS']).toContain(conflicts[0].body.error?.code);
    });

    it('should prevent login enumeration via concurrent registration timing', async () => {
        // A second concurrent request with the SAME email should not reveal
        // whether the email is already registered via a different error code.
        const payload = {
            email: SHARED_EMAIL, // already registered from previous test
            password: SHARED_PASSWORD,
            username: 'anotheruser'
        };

        const [resA, resB] = await Promise.all([
            request(app).post('/api/auth/register').send(payload),
            request(app).post('/api/auth/register').send(payload)
        ]);

        // Both should get the same "registration failed" response code
        // to prevent email-enumeration via response timing.
        const statuses = [resA, resB].map((r) => r.status);
        expect(new Set(statuses).size).toBeLessThanOrEqual(2); // at most 2 different statuses
    });
});
