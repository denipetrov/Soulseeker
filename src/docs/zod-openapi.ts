import { applyDecorators } from '@nestjs/common';
import { ApiQuery, type SchemaObject } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';

/**
 * Documents a route's query parameters from the zod schema that validates
 * them, so the docs and the validation cannot drift apart.
 *
 * The schema is described as the client sends it (`io: 'input'`): defaults and
 * limits come through on their own. Fields that normalise their input before
 * validating — `region` lowercases, then checks the enum — lose the enum on the
 * way, so those carry it in `.meta({ enum })`, which zod copies across along
 * with `description` and `example`.
 */
export function ApiZodQuery(schema: ZodType): MethodDecorator {
  const json = z.toJSONSchema(schema, {
    io: 'input',
    target: 'openapi-3.0',
    unrepresentable: 'any',
  }) as { properties?: Record<string, SchemaObject>; required?: string[] };

  const required = new Set(json.required ?? []);

  return applyDecorators(
    ...Object.entries(json.properties ?? {}).map(([name, property]) => {
      const { description, ...rest } = property;
      // JavaScript's safe-integer bound says nothing to a reader.
      if (rest.maximum === Number.MAX_SAFE_INTEGER) delete rest.maximum;

      return ApiQuery({ name, required: required.has(name), description, schema: rest });
    }),
  );
}
