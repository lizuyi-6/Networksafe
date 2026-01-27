/**
 * Authentication Routes
 * 
 * Handles user registration, login, and token management
 */

import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import {
    AuthenticatedRequest,
    generateTokens,
    verifyRefreshToken,
    authenticate
} from '../../middleware/auth.middleware';
import { getDatabase } from '../../config/database';
import logger from '../../utils/logger';

const router = Router();

// Password validation
const PASSWORD_MIN_LENGTH = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { email, password, username } = req.body;

        // Validate input
        if (!email || !password || !username) {
            return res.status(400).json({
                error: 'Email, password, and username are required',
                code: 'VALIDATION_ERROR'
            });
        }

        if (!EMAIL_REGEX.test(email)) {
            return res.status(400).json({
                error: 'Invalid email format',
                code: 'INVALID_EMAIL'
            });
        }

        if (password.length < PASSWORD_MIN_LENGTH) {
            return res.status(400).json({
                error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
                code: 'PASSWORD_TOO_SHORT'
            });
        }

        const db = getDatabase();

        // Check if user already exists
        const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
        if (existingUser) {
            return res.status(409).json({
                error: 'Email already registered',
                code: 'USER_EXISTS'
            });
        }

        // Hash password
        const saltRounds = 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Create user
        const userId = uuidv4();
        const tenantId = uuidv4(); // Each user gets their own tenant by default
        const role = 'tenant'; // Default role

        db.prepare(`
      INSERT INTO users (id, email, username, password_hash, role, tenant_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(userId, email, username, passwordHash, role, tenantId);

        // Generate tokens
        const tokens = generateTokens({
            userId,
            email,
            username,
            role,
            tenantId
        });

        logger.info(`New user registered: ${email}`);

        res.status(201).json({
            message: 'User registered successfully',
            user: {
                userId,
                email,
                username,
                role,
                tenantId
            },
            ...tokens
        });

    } catch (error: any) {
        logger.error('Registration error', { error: error.message });
        res.status(500).json({
            error: 'Registration failed',
            code: 'INTERNAL_ERROR'
        });
    }
});

/**
 * POST /api/auth/login
 * Authenticate user and return tokens
 */
router.post('/login', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                error: 'Email and password are required',
                code: 'VALIDATION_ERROR'
            });
        }

        const db = getDatabase();

        // Find user
        const user = db.prepare(`
      SELECT id, email, username, password_hash, role, tenant_id, status
      FROM users WHERE email = ?
    `).get(email) as any;

        if (!user) {
            return res.status(401).json({
                error: 'Invalid credentials',
                code: 'INVALID_CREDENTIALS'
            });
        }

        // Check if account is active
        if (user.status === 'suspended') {
            return res.status(403).json({
                error: 'Account suspended',
                code: 'ACCOUNT_SUSPENDED'
            });
        }

        // Verify password
        const passwordValid = await bcrypt.compare(password, user.password_hash);
        if (!passwordValid) {
            logger.warn(`Failed login attempt for: ${email}`);
            return res.status(401).json({
                error: 'Invalid credentials',
                code: 'INVALID_CREDENTIALS'
            });
        }

        // Update last login
        db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(user.id);

        // Generate tokens
        const tokens = generateTokens({
            userId: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            tenantId: user.tenant_id
        });

        logger.info(`User logged in: ${email}`);

        res.json({
            message: 'Login successful',
            user: {
                userId: user.id,
                email: user.email,
                username: user.username,
                role: user.role,
                tenantId: user.tenant_id
            },
            ...tokens
        });

    } catch (error: any) {
        logger.error('Login error', { error: error.message });
        res.status(500).json({
            error: 'Login failed',
            code: 'INTERNAL_ERROR'
        });
    }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                error: 'Refresh token required',
                code: 'TOKEN_MISSING'
            });
        }

        const decoded = verifyRefreshToken(refreshToken);
        if (!decoded) {
            return res.status(401).json({
                error: 'Invalid or expired refresh token',
                code: 'TOKEN_INVALID'
            });
        }

        const db = getDatabase();

        // Get user info
        const user = db.prepare(`
      SELECT id, email, username, role, tenant_id, status
      FROM users WHERE id = ?
    `).get(decoded.userId) as any;

        if (!user || user.status === 'suspended') {
            return res.status(401).json({
                error: 'User not found or suspended',
                code: 'USER_INVALID'
            });
        }

        // Generate new tokens
        const tokens = generateTokens({
            userId: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            tenantId: user.tenant_id
        });

        res.json({
            message: 'Token refreshed',
            ...tokens
        });

    } catch (error: any) {
        logger.error('Token refresh error', { error: error.message });
        res.status(500).json({
            error: 'Token refresh failed',
            code: 'INTERNAL_ERROR'
        });
    }
});

/**
 * GET /api/auth/me
 * Get current user info (requires authentication)
 */
router.get('/me', authenticate, (req: AuthenticatedRequest, res: Response) => {
    res.json({
        user: req.user
    });
});

/**
 * POST /api/auth/logout
 * Logout user (client should discard tokens)
 */
router.post('/logout', authenticate, (req: AuthenticatedRequest, res: Response) => {
    // In a production system, you might want to:
    // 1. Add token to a blacklist in Redis
    // 2. Invalidate all refresh tokens for this user
    // For now, we just acknowledge the logout

    logger.info(`User logged out: ${req.user?.email}`);

    res.json({
        message: 'Logout successful'
    });
});

/**
 * PUT /api/auth/password
 * Change user password
 */
router.put('/password', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: 'Current and new password required',
                code: 'VALIDATION_ERROR'
            });
        }

        if (newPassword.length < PASSWORD_MIN_LENGTH) {
            return res.status(400).json({
                error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
                code: 'PASSWORD_TOO_SHORT'
            });
        }

        const db = getDatabase();

        // Get current password hash
        const user = db.prepare('SELECT password_hash FROM users WHERE id = ?')
            .get(req.user!.userId) as any;

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Verify current password
        const passwordValid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!passwordValid) {
            return res.status(401).json({
                error: 'Current password is incorrect',
                code: 'INVALID_PASSWORD'
            });
        }

        // Hash new password
        const newPasswordHash = await bcrypt.hash(newPassword, 12);

        // Update password
        db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(newPasswordHash, req.user!.userId);

        logger.info(`Password changed for user: ${req.user?.email}`);

        res.json({
            message: 'Password changed successfully'
        });

    } catch (error: any) {
        logger.error('Password change error', { error: error.message });
        res.status(500).json({
            error: 'Password change failed',
            code: 'INTERNAL_ERROR'
        });
    }
});

export default router;
