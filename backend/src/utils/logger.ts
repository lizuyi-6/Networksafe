// Logger Utility
// SECURITY FIX RISK-003: Integrated log sanitization to prevent sensitive data leakage

import { sanitize } from './log-sanitizer';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private enableSanitization = true;

  constructor() {
    // Can be disabled via environment variable for debugging
    if (process.env.DISABLE_LOG_SANITIZATION === 'true') {
      this.enableSanitization = false;
    }
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
    if (process.env.NODE_ENV !== 'production') {
      console.debug(this.formatMessage('debug', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    console.info(this.formatMessage('info', message, context));
  }

  warn(message: string, context?: LogContext): void {
    console.warn(this.formatMessage('warn', message, context));
  }

  error(message: string, context?: LogContext): void {
    console.error(this.formatMessage('error', message, context));
  }
}

export default new Logger();

