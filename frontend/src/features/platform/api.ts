import { unwrap } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { ChargeSituation, PlanCode, SubscriptionStatus } from '@/api/types';
import { useSession } from '@/session/SessionContext';
import { usePlatformInfiniteQuery, usePlatformQuery } from './platformQuery';

/** Rotas /admin usam o cliente de identidade: nunca enviam empresa selecionada. */
function usePlatformApi() {
  const { api, user } = useSession();
  const key = (...rest: string[]) => queryKeys.platform(user?.uid ?? '', ...rest);
  return { api, key };
}

export function useOverview() {
  const { api, key } = usePlatformApi();
  return usePlatformQuery(key('overview'), () => unwrap(api.GET('/api/v1/admin/overview')));
}

export type CompanyFilters = {
  q?: string;
  planCode?: PlanCode | 'custom' | 'legacy';
  status?: SubscriptionStatus;
  attention?: 'overdue' | 'open';
};

export function useCompanies(filters: CompanyFilters = {}) {
  const { api, key } = usePlatformApi();
  const query = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as CompanyFilters;
  return usePlatformQuery([...key('companies'), query], () =>
    unwrap(api.GET('/api/v1/admin/companies', { params: { query } })),
  );
}

export function useCompany(id: string) {
  const { api, key } = usePlatformApi();
  return usePlatformQuery(key('company', id), () =>
    unwrap(api.GET('/api/v1/admin/companies/{id}', { params: { path: { id } } })),
  );
}

export function usePlanCatalog() {
  const { api, key } = usePlatformApi();
  return usePlatformQuery(key('plan-catalog'), () => unwrap(api.GET('/api/v1/admin/plan-catalog')));
}

export function usePlanChangePreview(subscriptionId: string, planCode: PlanCode | null) {
  const { api, key } = usePlatformApi();
  return usePlatformQuery(
    key('plan-change', subscriptionId, planCode ?? ''),
    () =>
      unwrap(
        api.GET('/api/v1/admin/subscriptions/{id}/plan-change', {
          params: { path: { id: subscriptionId }, query: { planCode: planCode as PlanCode } },
        }),
      ),
    { enabled: planCode !== null },
  );
}

export function useCustomPlans(status?: 'active' | 'inactive') {
  const { api, key } = usePlatformApi();
  return usePlatformQuery([...key('custom-plans'), status ?? 'all'], () =>
    unwrap(api.GET('/api/v1/admin/custom-plans', { params: { query: status ? { status } : {} } })),
  );
}

export function useCustomPlan(id: string) {
  const { api, key } = usePlatformApi();
  return usePlatformQuery(key('custom-plan', id), () =>
    unwrap(api.GET('/api/v1/admin/custom-plans/{id}', { params: { path: { id } } })),
  );
}

export function useCustomPlanHistory(id: string) {
  const { api, key } = usePlatformApi();
  return usePlatformQuery(key('custom-plan-history', id), () =>
    unwrap(api.GET('/api/v1/admin/custom-plans/{id}/history', { params: { path: { id } } })),
  );
}

export function useCustomPlanPreview(subscriptionId: string, planId: string | null) {
  const { api, key } = usePlatformApi();
  return usePlatformQuery(
    key('plan-change', 'custom', subscriptionId, planId ?? ''),
    () =>
      unwrap(
        api.GET('/api/v1/admin/subscriptions/{id}/custom-plan-change', {
          params: { path: { id: subscriptionId }, query: { planId: planId as string } },
        }),
      ),
    { enabled: planId !== null },
  );
}

export function useContractDiff(subscriptionId: string) {
  const { api, key } = usePlatformApi();
  return usePlatformQuery(key('contract-diff', subscriptionId), () =>
    unwrap(
      api.GET('/api/v1/admin/subscriptions/{id}/contract-diff', {
        params: { path: { id: subscriptionId } },
      }),
    ),
  );
}

export function useSubscriptionHistory(subscriptionId: string) {
  const { api, key } = usePlatformApi();
  return usePlatformQuery(key('subscription-history', subscriptionId), () =>
    unwrap(
      api.GET('/api/v1/admin/subscriptions/{id}/history', {
        params: { path: { id: subscriptionId } },
      }),
    ),
  );
}

export function useChargeHistory(chargeId: string, enabled: boolean) {
  const { api, key } = usePlatformApi();
  return usePlatformQuery(
    key('charge-history', chargeId),
    () =>
      unwrap(api.GET('/api/v1/admin/charges/{id}/history', { params: { path: { id: chargeId } } })),
    { enabled },
  );
}

export type ChargeFilter = 'all' | 'open' | ChargeSituation;

export function useCharges(situation: ChargeFilter, tenantId?: string) {
  const { api, key } = usePlatformApi();
  return usePlatformInfiniteQuery(key('charges', situation, tenantId ?? ''), (cursor) =>
    unwrap(
      api.GET('/api/v1/admin/charges', {
        params: {
          query: {
            situation: situation === 'pending' ? 'open' : situation,
            limit: '50',
            ...(tenantId ? { tenantId } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    ),
  );
}

export function useOwnerInvitations() {
  const { api, key } = usePlatformApi();
  return usePlatformQuery(key('owner-invitations'), () =>
    unwrap(api.GET('/api/v1/admin/invitations')),
  );
}

export { usePlatformApi };
