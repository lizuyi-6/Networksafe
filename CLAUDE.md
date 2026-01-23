# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

API Security Middleware Suite - A comprehensive, production-ready security middleware package for Express.js APIs. This standalone npm package provides anti-bot protection, rate limiting, concurrency control, and authentication security services extracted from an API Gateway project.

## Common Development Commands

```bash
# Build the project
npm run build

# Watch mode for development
npm run dev

# Run linter
npm run lint

# Format code
npm run format

# Clean build artifacts
npm run clean

# Install dependencies
npm install
```

## Architecture

This is a TypeScript npm package with the following structure:

### Core Exports (src/index.ts)

The package exports these main components:

**Middleware:**
- `antiBotMiddleware` / `AntiBotMiddleware` - Bot detection and protection
- `rateLimitMiddleware` - Redis-backed distributed rate limiting
- `concurrencyLimit` - Per-user concurrent request control
- `performanceMonitor` - Request timing and performance tracking

**Services:**
- `authSecurityService` / `AuthSecurityService` - Authentication security (login attempts, account lockout, password validation, session management)

**Utilities:**
- `startMemoryMonitoring()` - Background memory usage tracking
- `startCPUMonitoring()` - Background CPU usage tracking
- `stopMonitoring()` - Cleanup monitoring resources

**Types & Config:**
- All types from `src/types.ts`
- All configuration constants from `src/config.ts` (including `defaultConfig`, `HTTP_STATUS`, `REDIS_KEYS`)

### Module Organization

```
src/
├── middleware/
│   ├── anti-bot.middleware.ts      # Multi-layer bot detection
│   ├── ratelimit.middleware.ts     # Redis atomic rate limiting
│   └── concurrency.middleware.ts   # Concurrency + performance monitoring
├── services/
│   ├── auth-security.service.ts    # Auth security logic
│   └── redis.service.ts            # Redis client wrapper
├── utils/
│   └── logger.ts                   # Logging utility
├── config.ts                        # All default configuration
├── types.ts                         # TypeScript interfaces
└── index.ts                         # Public API exports
```

## Key Implementation Details

### Middleware Order Matters

When applying security middleware, follow this sequence:

1. `antiBotMiddleware.protect` - Outermost layer, blocks malicious requests early
2. `performanceMonitor` - Track all request timings
3. `concurrencyLimit` - Limit concurrent requests before rate limiting
4. `rateLimitMiddleware` - Apply per-user rate limits (requires user identification)

### Redis Dependency

Most features require Redis connection:
- Rate limiting (distributed counters with atomic operations)
- Anti-bot (request tracking, IP blocking)
- Auth security (login attempt tracking, account locks)

Redis connection is managed through `src/services/redis.service.ts` with automatic reconnection.

### Environment-Based Behavior

Security checks are automatically **disabled in non-production environments** (when `NODE_ENV !== 'production'`). This is intentional for development ease. To test security features:

```bash
NODE_ENV=production npm test
```

### Configuration

Default configuration is in `src/config.ts`. To customize:

1. Import and modify `defaultConfig` object
2. Set environment variables:
   - `REDIS_URL` - Redis connection string (required)
   - `NODE_ENV` - Environment (affects security enforcement)

### Anti-Bot Detection Layers

The `AntiBotMiddleware` uses multiple detection strategies:

1. Known bot whitelist (Google, Bing, etc.) - Always allowed
2. Suspicious User-Agent patterns - Blocked
3. Request rate thresholding - Sliding window (configurable)
4. Fast sequential requests - Detects automated scripts
5. Honeypot fields - Checks for `website_confirm` field in request body
6. IP blocking - Automatic blocking for repeated violations

### Rate Limiting Architecture

Rate limiting uses Redis Lua scripts for **atomic operations** to prevent race conditions:
- Key format: `ratelimit:{userId}:requests`
- Sliding window algorithm
- Returns standard HTTP headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`

Requires user identification middleware to run **before** it (e.g., API key auth).

### Concurrency Control

Per-user concurrent request tracking uses in-memory Maps:
- Active requests map: `Map<userId, Set<requestId>>`
- Queue map: `Map<userId, Array<queuedRequest>>`
- Automatic cleanup of stale requests (prevents memory leaks)
- Thread-safe slot acquisition using request IDs

### Auth Security Service

The `AuthSecurityService` provides:

- **Password validation**: Checks length, case, numbers, special characters, returns strength score
- **Login attempt tracking**: Records success/failure per email and IP
- **Account lockout**: Auto-locks after N failed attempts (configurable)
- **Suspicious login detection**: Checks for unusual patterns (IP changes, fast attempts)
- **Session management**: Generates session IDs, validates sessions, limits concurrent sessions
- All state stored in Redis with TTL

## Build Output

The package builds to `dist/` with:
- CommonJS modules (`.js`)
- TypeScript declaration files (`.d.ts`)
- Main entry: `dist/index.js`
- Types entry: `dist/index.d.ts`

## Testing

Currently, no test framework is configured. The `npm test` script is a placeholder.

To run in production-like mode for testing security features:
```bash
NODE_ENV=production node your-test-file.js
```

## Important Notes

- **Never modify `dist/` directory** - It's generated by `npm run build`
- **Redis must be running** for most features to work
- **Development mode bypasses security** - Set `NODE_ENV=production` to enable
- **Middleware order is critical** - See "Middleware Order Matters" above
- **Rate limiting requires user ID** - Must follow authentication/identification middleware
