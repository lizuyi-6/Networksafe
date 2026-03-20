// Logger Utility
// SECURITY FIX RISK-003: Integrated log sanitization to prevent sensitive data leakage

import { sanitize } from './log-sanitizer';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private enableSanitization = true;
  private logLevel: LogLevel;

  constructor() {
    // Can be disabled via environment variable for debugging
    if (process.env.DISABLE_LOG_SANITIZATION === 'true') {
      this.enableSanitization = false;
    }

    this.logLevel = this.resolveLogLevel();
  }

  private resolveLogLevel(): LogLevel {
    const configuredLevel = (process.env.LOG_LEVEL || '').toLowerCase();
    if (configuredLevel in LOG_LEVEL_ORDER) {
      return configuredLevel as LogLevel;
    }

    return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.logLevel];
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();

    // SECURITY: Sanitize context to remove sensitive information
    const sanitizedContext = this.enableSanitization && context
      ? sanitize(context)
      : context;

    const contextStr = sanitizedContext ? ` ${JSON.stringify(sanitizedContext)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, context));
    }
  }
}

export default new Logger();

