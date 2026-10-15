import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { routeDefinitions } from '../../src/app/routes.js';
import { openApiDocument } from '../../src/modules/auth/openapi.js';
import { schedule } from '../../src/shared/schemas/paymentSettings.js';
import type { operations } from '../../docs/api/generated-types.js';
type RequiredNumber<T extends number> = T;
export type MaterializedResponseWeight = RequiredNumber<
  operations['listConditionOptions']['responses'][200]['content']['application/json']['data']['items'][number]['schedule'][number]['weight']
>;

describe('F07: semântica de saída no contrato', () => {
  it('representa todos os envelopes JSON pela saída de Zod', () => {
    const api = openApiDocument();
    for (const route of routeDefinitions.filter((r) => !r.binaryOutput)) {
      const path = `/api/v1${route.path.replace(/:([a-zA-Z]+)/g, '{$1}')}`;
      const operation = api.paths[path]![route.method]! as { responses: unknown };
      const response = operation.responses as Record<
        string,
        { content: { 'application/json': { schema: unknown } } }
      >;
      expect(
        response[route.status ?? 200]!.content['application/json'].schema,
        route.operationId,
      ).toEqual(
        z.toJSONSchema(z.strictObject({ data: route.output, requestId: z.string().uuid() }), {
          target: 'draft-2020-12',
          io: 'output',
        }),
      );
    }
  });
  it('materializa weight e distingue entrada e saída', () => {
    expect(schedule.parse([{ offsetDays: 30 }])).toEqual([{ offsetDays: 30, weight: 1 }]);
    expect(z.toJSONSchema(schedule, { io: 'input' }).items).toMatchObject({
      required: ['offsetDays'],
    });
    expect(z.toJSONSchema(schedule, { io: 'output' }).items).toMatchObject({
      required: ['offsetDays', 'weight'],
    });
  });
});
