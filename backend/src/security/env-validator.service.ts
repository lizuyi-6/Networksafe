/**
 * Environment Variable Validator
 *
 * SECURITY: Validates and sanitizes all environment variables at startup
 * Prevents misconfiguration and detects missing critical variables
 */

import logger from '../utils/logger';

export class EnvValidator {
  private static validated = new Set<string>();

  /**
   * Validate a required environment variable
   */
  static require(key: string, options: {
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    description?: string;
  } = {}): string {
    // Only validate once
    if (this.validated.has(key)) {
      return process.env[key]!;
    }

    const value = process.env[key];

    if (!value) {
      const error = `FATAL: Required environment variable ${key} is ${options.description ? `(${options.description}) ` : ''}not set`;
      logger.error(error);
      throw new Error(error);
    }

    // Length validation
    if (options.minLength && value.length < options.minLength) {
      const error = `FATAL: Environment variable ${key} must be at least ${options.minLength} characters long (got ${value.length})`;
      logger.error(error);
      throw new Error(error);
    }

    if (options.maxLength && value.length > options.maxLength) {
      const error = `FATAL: Environment variable ${key} must be at most ${options.maxLength} characters long (got ${value.length})`;
      logger.error(error);
      throw new Error(error);
    }

    // Pattern validation
    if (options.pattern && !options.pattern.test(value)) {
      const error = `FATAL: Environment variable ${key} does not match required pattern`;
      logger.error(error);
      throw new Error(error);
    }

    this.validated.add(key);
    return value;
  }

  /**
   * Validate an optional environment variable
   */
  static optional(key: string, defaultValue: string = '', options: {
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    allowedValues?: string[];
  } = {}): string {
    if (this.validated.has(key)) {
      return process.env[key] || defaultValue;
    }

    const value = process.env[key] || defaultValue;

    // Length validation
    if (options.minLength && value.length < options.minLength) {
      logger.warn(`Environment variable ${key} is too short, using default value`);
      return defaultValue;
    }

    if (options.maxLength && value.length > options.maxLength) {
      logger.warn(`Environment variable ${key} is too long, truncating`);
      return value.substring(0, options.maxLength);
    }

    // Pattern validation
    if (options.pattern && !options.pattern.test(value)) {
      logger.warn(`Environment variable ${key} does not match required pattern, using default value`);
      return defaultValue;
    }

    // Allowed values validation
    if (options.allowedValues && !options.allowedValues.includes(value)) {
      logger.warn(`Environment variable ${key} has invalid value, using default value`);
      return defaultValue;
    }

    this.validated.add(key);
    return value;
  }

  /**
   * Validate all critical environment variables at startup
   */
  static validateAll(): void {
    try {
      // Critical security variables
      this.require('JWT_SECRET', {
        minLength: 32,
        description: 'JWT signing secret'
      });

      this.require('AUDIT_LOG_SECRET', {
        minLength: 32,
        description: 'Audit log signing secret'
      });

      // Admin credentials
      this.require('ADMIN_EMAIL', {
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        description: 'Admin email address'
      });

      this.require('ADMIN_PASSWORD', {
        minLength: 12,
        description: 'Admin password'
      });

      // Optional variables with defaults
      this.optional('NODE_ENV', 'development', {
        allowedValues: ['development', 'production', 'test']
      });

      this.optional('PORT', '3005', {
        pattern: /^\d{1,5}$/,
        minLength: 1,
        maxLength: 5
      });

      this.optional('DATA_DIR', './data');
      this.optional('REDIS_HOST', 'localhost');
      this.optional('REDIS_PORT', '6379');

      // API Keys (optional)
      this.optional('OPENAI_API_KEY', '');
      this.optional('ANTHROPIC_API_KEY', '');
      this.optional('AI_PROVIDER', 'ollama');
      this.optional('AI_MODEL', 'llama2');

      // CORS
      this.optional('ALLOWED_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173');

      // Log level
      this.optional('LOG_LEVEL', 'info', {
        allowedValues: ['error', 'warn', 'info', 'debug']
      });

      logger.info('Environment variables validated successfully', {
        validatedCount: this.validated.size
      });
    } catch (error) {
      logger.error('Environment variable validation failed', { error });
      throw error;
    }
  }

  /**
   * Get validation report (for debugging)
   */
  static getReport(): { validated: string[]; timestamp: string } {
    return {
      validated: Array.from(this.validated),
      timestamp: new Date().toISOString()
    };
  }
}

// Export singleton instance
export default EnvValidator;
