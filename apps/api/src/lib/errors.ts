/**
 * Centralized error contract. Every error response has the shape
 *   { error: { code, message, details? } }
 * (SPEC §17, BUILD_BRIEF cross-cutting). `AppError` carries an HTTP status and a
 * stable machine code; the Fastify error handler renders it.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'NOT_IMPLEMENTED'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_ERROR';

export interface ErrorBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly details?: unknown;
  };
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function notFound(message: string, details?: unknown): AppError {
  return new AppError(404, 'NOT_FOUND', message, details);
}

export function validationError(message: string, details?: unknown): AppError {
  return new AppError(400, 'VALIDATION_ERROR', message, details);
}

/** Standard 501 body for round-2 endpoints (BUILD_BRIEF). */
export function notImplemented(message = 'Planned for round 2'): AppError {
  return new AppError(501, 'NOT_IMPLEMENTED', message);
}

export function toErrorBody(code: ErrorCode, message: string, details?: unknown): ErrorBody {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}
