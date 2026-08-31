// Logger Utility
// SECURITY FIX RISK-003: Integrated log sanitization to prevent sensitive data leakage

import { sanitize, sanitizeString } from './log-sanitizer';

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
    // Can be disabled via environment variable for debugging — but NEVER in
    // production (N5-4): a prod misconfiguration must not turn the log
    // stream into a credential firehose.
    if (process.env.DISABLE_LOG_SANITIZATION === 'true' && process.env.NODE_ENV !== 'production') {
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

    // N5-4: the message STRING is a credential channel too (error messages
    // frequently embed tokens/headers verbatim) — sanitize it like the
    // context object instead of interpolating it raw.
    const sanitizedMessage = this.enableSanitization ? sanitizeString(message) : message;

    const contextStr = sanitizedContext ? ` ${JSON.stringify(sanitizedContext)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${sanitizedMessage}${contextStr}`;
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

