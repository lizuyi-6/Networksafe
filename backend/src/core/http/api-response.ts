import { Response } from 'express';

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
