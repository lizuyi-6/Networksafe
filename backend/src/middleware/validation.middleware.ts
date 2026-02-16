import { NextFunction, Request, Response } from 'express';

type JsonSchema = {
  body?: {
    type?: string;
    required?: string[];
  };
};

// Lightweight request validator used by API routes.
export function validateRequest(schema: JsonSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const required = schema.body?.required ?? [];
    for (const field of required) {
      if (req.body?.[field] === undefined || req.body?.[field] === null) {
        res.status(400).json({
          success: false,
          error: `Missing required field: ${field}`
        });
        return;
      }
    }
    next();
  };
}
