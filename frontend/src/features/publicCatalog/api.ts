import type { ApiClient } from '@/api/client';
import { unwrap } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { CatalogInput } from '@/api/types';
import { catalogInputSchema } from './rules';
import { intentLedger, outcomeOf, PendingIntentError, withDeadline } from '@/lib/intent';

const inFlight = new Set<string>();
export async function configureCatalog(
  api: ApiClient,
  tenantId: string,
  scope: string,
  input: CatalogInput,
  check: () => void,
) {
  if (inFlight.has(scope)) throw new Error('Configuração já está sendo enviada.');
  inFlight.add(scope);
  let pending = intentLedger.get(scope)?.unknown;
  try {
    pending = pending || (await intentLedger.persistedPending(scope));
    const key = await intentLedger.prepare(scope, catalogInputSchema.parse(input));
    const body = intentLedger.get(scope)!.body as CatalogInput;
    check();
    const result = await withDeadline((signal) =>
      unwrap(
        api.PUT('/api/v1/catalog-settings', {
          params: { header: { 'X-Tenant-Id': tenantId, 'Idempotency-Key': key } },
          body,
          signal,
        }),
      ),
    );
    if (
      !catalogInputSchema.safeParse({ ...result, expectedVersion: result.version }).success ||
      !Number.isSafeInteger(result.version) ||
      result.version < 1 ||
      result.slug !== body.slug
    )
      throw new ApiError(
        503,
        'REQUEST_OUTCOME_UNKNOWN',
        'Resposta incompleta. Repita a configuração com a mesma intenção.',
      );
    await intentLedger.finish(scope);
    return result;
  } catch (e) {
    if (!(e instanceof PendingIntentError)) {
      if (pending || outcomeOf(e).status === 'unknown') intentLedger.markUnknown(scope);
      else await intentLedger.reject(scope);
    }
    throw e;
  } finally {
    inFlight.delete(scope);
  }
}
