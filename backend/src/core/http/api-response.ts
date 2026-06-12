import { Response } from 'express';
import { sanitizeObject, sanitizeString } from '../../utils/log-sanitizer';
import logger from '../../utils/logger';

export interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  error: null;
  meta?: Record<string, any>;
}

export interface ApiErrorDetails {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorEnvelope {
  success: false;
  data: null;
  error: ApiErrorDetails;
  meta?: Record<string, any>;
}

interface ResponseOptions {
  meta?: Record<string, any>;
  legacy?: Record<string, any>;
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  options: ResponseOptions = {},
  statusCode = 200
): Response<ApiSuccessEnvelope<T>> {
  const body: Record<string, any> = {
    success: true,
    data,
    error: null
  };

  if (options.meta) {
    body.meta = options.meta;
  }

  if (options.legacy) {
    Object.assign(body, options.legacy);
  }

  return res.status(statusCode).json(body);
}

/**
 * SECURITY (R3 audit 2026-06-05 / R7 V7.5): convert a thrown error into a
 * client-safe i18n fallback key. The raw error message is NEVER returned
 * to the client — SQL constraints, filesystem paths, JWTs, API keys, and
 * internal stack traces can all leak through `error.message`.
 *
 * Contract:
 *   - Always returns `fallback` (the caller-provided i18n key), never the
 *     raw error string. Even non-Error throws (strings, plain objects) get
 *     the fallback.
 *   - Logs the raw error for operator visibility, but FIRST runs it
 *     through the log-sanitizer so JWTs / API keys / passwords inside the
 *     raw message or the `context` object are redacted.
 *
 * @param error  the thrown value (Error, string, object, null/undefined)
 * @param fallback  i18n key returned to the caller, e.g. 'backend.database_error'
 * @param context  optional operator-context object; its string values are
 *                 sanitized the same way as the error.
 */
export function safeErrorMessage(
  error: unknown,
  fallback: string,
  context?: Record<string, unknown>
): string {
  // Always return the fallback — the caller chose the user-facing key.
  // We still log the raw error for operators, but it never leaves this
  // function as a return value.

  let rawMessage: string;
  if (error instanceof Error) {
    rawMessage = error.message || String(error);
  } else if (typeof error === 'string') {
    rawMessage = error;
  } else if (error === null || error === undefined) {
    rawMessage = '';
  } else {
    try {
      rawMessage = JSON.stringify(error);
    } catch {
      rawMessage = String(error);
    }
  }

  const sanitizedMessage = sanitizeString(rawMessage);
  const sanitizedContext = context ? sanitizeObject(context) : context;

  try {
    logger.error('safeErrorMessage: returning fallback for error', {
      fallback,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: sanitizedMessage,
      context: sanitizedContext
    });
  } catch {
    // Logger must never break the response path — swallow.
  }

  return fallback;
}

export function sendError(
  res: Response,
  statusCode: number,
  error: ApiErrorDetails,
  options: ResponseOptions = {}
): Response<ApiErrorEnvelope> {
  const body: Record<string, any> = {
    success: false,
    data: null,
    error,
    code: error.code,
    message: error.message
  };

  if (options.meta) {
    body.meta = options.meta;
  }

  if (options.legacy) {
    Object.assign(body, options.legacy);
  }

  return res.status(statusCode).json(body);
}
