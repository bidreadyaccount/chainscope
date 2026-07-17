/**
 * Zod validation helper (BUILD_BRIEF cross-cutting: Zod on every route,
 * params/query/body, 400 structured errors). A single place that turns a Zod
 * failure into an `AppError` with `details` listing every issue.
 */

import type { z } from 'zod';
import { validationError } from './errors.js';

export function parseOrThrow<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
  where: string,
): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    }));
    throw validationError(`Invalid ${where}`, details);
  }
  return result.data;
}
