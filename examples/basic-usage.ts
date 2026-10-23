/**
 * Basic Usage Example
 *
 * This example demonstrates how to set up the API Security Middleware
 * with an Express.js application.
 */

import express from 'express';
import antiBotMiddleware from '../backend/src/security/anti-bot.middleware';
import authSecurityService from '../backend/src/security/auth-security.service';
import { rateLimitMiddleware } from '../backend/src/security/ratelimit.middleware';
import {
  concurrencyLimit,
  performanceMonitor,
  startMemoryMonitoring,
  startCPUMonitoring,
  stopMonitoring
} from '../backend/src/security/concurrency.middleware';

const app = express();

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply security middleware
app.use(antiBotMiddleware.protect);
app.use(rateLimitMiddleware);
app.use(performanceMonitor);
app.use(concurrencyLimit);

// Login route with auth security
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Validate password strength
    const passwordCheck = authSecurityService.validatePassword(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Password does not meet security requirements',
          details: passwordCheck.errors
        }
      });
    }

    // Check for suspicious login
    const warnings = await authSecurityService.detectSuspiciousLogin(req, email);
    if (warnings.length > 0) {
      console.warn('Suspicious login detected:', { email, warnings });
    }

    // Check if account is locked
    const isLocked = await authSecurityService.isAccountLocked(email);
    if (isLocked) {
      const lockInfo = await authSecurityService.getLockInfo(email);
      return res.status(429).json({
        success: false,
        error: {
          message: 'Account temporarily locked',
          reason: lockInfo.reason,
          retryAfter: lockInfo.remainingTime
        }
      });
    }

    // Perform authentication (replace with your actual logic)
    const success = await authenticateUser(email, password);

    // Record login attempt
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    await authSecurityService.recordLoginAttempt(email, ip, success);

    if (!success) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Invalid credentials'
        }
      });
    }

    // Generate session
    const sessionId = authSecurityService.generateSessionId();
    await authSecurityService.addSession(
      'user-id',
      sessionId,
      {
        ip,
        userAgent: req.headers['user-agent'],
        createdAt: Date.now()
      }
    );

    res.json({
      success: true,
      data: {
        message: 'Login successful',
        sessionId
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Internal server error'
      }
    });
  }
});

// Register route with password validation
app.post('/api/register', async (req, res) => {
  const { email, password, username } = req.body;

  // Validate password
  const passwordCheck = authSecurityService.validatePassword(password);
  if (!passwordCheck.valid) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Password does not meet security requirements',
        details: passwordCheck.errors,
        strength: passwordCheck.strength
      }
    });
  }

  // Create user (replace with your actual logic)
  try {
    await createUser({ email, username, password });
    res.json({
      success: true,
      data: {
        message: 'Registration successful'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        message: 'Registration failed'
      }
    });
  }
});

// Protected route example
app.get('/api/protected', async (req, res) => {
  res.json({
    success: true,
    data: {
      message: 'This is a protected route'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Helper functions (replace with your actual implementation)
async function authenticateUser(email: string, password: string): Promise<boolean> {
  // Your authentication logic here
  return true;
}

interface NewUser {
  email: string;
  username: string;
  password: string;
}

async function createUser(userData: NewUser): Promise<void> {
  // Your user creation logic here
}

// Start monitoring
startMemoryMonitoring();
startCPUMonitoring();

// Start server
const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  stopMonitoring();
  server.close(() => process.exit(0));
});
