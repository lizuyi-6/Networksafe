/**
 * Jest 测试环境设置
 *
 * 配置测试所需的环境变量和全局设置
 */

// 设置测试环境变量
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-minimum-32-characters-long';
process.env.AUDIT_LOG_SECRET = 'test-audit-log-secret-minimum-32-characters';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'AdminPass123!';
process.env.DATA_DIR = './test-data';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173';

// 禁用 Redis 连接错误日志（测试时 Redis 可能未运行）
process.env.DISABLE_REDIS = 'true';

// 设置超时
jest.setTimeout(10000);
