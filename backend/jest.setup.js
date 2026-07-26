/**
 * Jest 测试环境设置
 *
 * 配置测试所需的环境变量和全局设置
 */

// 设置测试环境变量
process.env.NODE_ENV = 'test';
// V4.3 multi-factor gate: test-runtime backdoors (auth bypass, relaxed
// password checks) require an explicit opt-in. Every Jest run sets it.
process.env.ALLOW_TEST_RUNTIME = 'true';
process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long';
process.env.AUDIT_LOG_SECRET = 'test-audit-log-secret-minimum-32-characters';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'AdminPass123!';
process.env.DATA_DIR = './test-data';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173';

// Jest workers use per-process sql.js snapshots. Pin the repository runtime
// mode too, so an outer release environment cannot route unit tests into the
// Postgres source-of-truth path while the test harness provides a SQLite DB.
// Postgres/fallback contract suites override these values inside their cases.
process.env.DB_MODE = 'sqlite';
process.env.SQLITE_FALLBACK_ENABLED = 'true';
delete process.env.SHADOW_DATABASE_URL;

// 禁用 Redis 连接错误日志（测试时 Redis 可能未运行）
process.env.DISABLE_REDIS = 'true';

// 加密环境变量（agent-auth / command-signing 测试需要）
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-ok!';
process.env.ENCRYPTION_SALT = 'test-salt-16-char!';

// 设置超时
jest.setTimeout(10000);
