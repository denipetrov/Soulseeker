import { z } from 'zod';

/**
 * A required numeric query parameter. `z.coerce.number()` alone turns a missing
 * value into `NaN` and reports "expected number, received NaN"; this says
 * `is required` for a missing or empty one and `must be a number` for text,
 * then hands the value to `schema` for the rest (integer, range, allow-list).
 * The OpenAPI document is the schema's own.
 */
export function requiredNumber<T extends z.ZodType>(schema: T) {
  return z.preprocess((value, ctx) => {
    if (value === undefined || value === '') {
      ctx.addIssue({ code: 'custom', message: 'is required' });
      return z.NEVER;
    }
    if (typeof value === 'string' && Number.isNaN(Number(value))) {
      ctx.addIssue({ code: 'custom', message: 'must be a number' });
      return z.NEVER;
    }

    return value;
  }, schema);
}
