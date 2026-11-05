import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { ApiError } from '@/api/errors';
import type {
  ExpenseCategory,
  FinanceSettingsInput,
  ManagementQuery,
  PayableBody,
  PayablePaymentBody,
  PayableUpdateBody,
  PurchaseAmendmentBody,
  PurchaseClosureBody,
  PurchaseConfirmBody,
  PurchaseCreateBody,
  PurchaseReceiptBody,
  PurchaseUpdateBody,
  RecurringCreateBody,
  RecurringUpdateBody,
} from '@/api/types';
import { useCursorList } from '@/features/catalog/useCursorList';
import { useIntentKey } from '@/lib/idempotency';
import { useTenantApi } from '@/session/SessionContext';

const areaKey = (tenantId: string) => ['tenant', tenantId, 'management'] as const;

/**
 * Comando com Idempotency-Key: repetir depois de falha de rede usa a mesma chave; recusa do
 * servidor libera a chave para a próxima tentativa. Sucesso recarrega tudo que depende de compras
 * e títulos, inclusive estoque, porque o recebimento movimenta saldos.
 */
function useCommand<V, R>(run: (input: V, key: string) => Promise<R>) {
  const intent = useIntentKey();
  const { tenantId } = useTenantApi();
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (input: V) => run(input, intent.current()),
    onSuccess: () => {
      intent.reset();
      void cache.invalidateQueries({ queryKey: areaKey(tenantId) });
      void cache.invalidateQueries({ queryKey: ['tenant', tenantId, 'inventory'] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status < 500) intent.reset();
    },
  });
}
function useHeaders() {
  const { api, tenantId, header } = useTenantApi();
  return {
    api,
    tenantId,
    header,
    keyed: (key: string) => ({ ...header, 'Idempotency-Key': key }),
  };
}

/* ---------- Fornecedores e custos ---------- */

export function useSuppliers(q: string, enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useCursorList(
    [...areaKey(tenantId), 'suppliers', q],
    (cursor) =>
      unwrap(
        api.GET('/api/v1/suppliers', {
          params: {
            header,
            query: { limit: '50', ...(q ? { q } : {}), ...(cursor ? { cursor } : {}) },
          },
        }),
      ),
    enabled,
  );
}
export function useProductCosts(productId: string, enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: [...areaKey(tenantId), 'costs', productId],
    enabled,
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/products/{id}/costs', {
          params: { header, path: { id: productId } },
        }),
      ),
  });
}
export function useCostHistory(productId: string, enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useCursorList(
    [...areaKey(tenantId), 'cost-history', productId],
    (cursor) =>
      unwrap(
        api.GET('/api/v1/products/{id}/cost-history', {
          params: {
            header,
            path: { id: productId },
            query: { limit: '10', ...(cursor ? { cursor } : {}) },
          },
        }),
      ),
    enabled,
  );
}
export function useUpdateReferenceCost(productId: string) {
  const { api, tenantId, header } = useTenantApi();
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (body: { expectedVersion: number; referenceCostCents: number | null }) =>
      unwrap(
        api.PATCH('/api/v1/products/{id}/costs', {
          params: { header, path: { id: productId } },
          body,
        }),
      ),
    onSuccess: () => cache.invalidateQueries({ queryKey: areaKey(tenantId) }),
  });
}
/** Busca pontual ao incluir um produto na compra. */
export function useCostSuggestion() {
  const { api, header } = useTenantApi();
  return (productId: string) =>
    unwrap(
      api.GET('/api/v1/products/{id}/cost-suggestion', {
        params: { header, path: { id: productId } },
      }),
    );
}

/* ---------- Compras ---------- */

export type PurchaseFilters = {
  status?: 'draft' | 'confirmed' | 'partially_received' | 'received' | 'closed' | 'canceled';
  pendingReceipt?: boolean;
};
export function usePurchases(filters: PurchaseFilters) {
  const { api, tenantId, header } = useTenantApi();
  return useCursorList([...areaKey(tenantId), 'purchases', filters], (cursor) =>
    unwrap(
      api.GET('/api/v1/purchases', {
        params: {
          header,
          query: {
            limit: '25',
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.pendingReceipt ? { pendingReceipt: 'true' as const } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    ),
  );
}
export function usePurchase(id: string) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: [...areaKey(tenantId), 'purchase', id],
    queryFn: () => unwrap(api.GET('/api/v1/purchases/{id}', { params: { header, path: { id } } })),
  });
}
export function usePurchaseReceipts(id: string) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: [...areaKey(tenantId), 'purchase', id, 'receipts'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/purchases/{id}/receipts', {
          params: { header, path: { id }, query: { limit: '100' } },
        }),
      ),
  });
}
export function usePurchaseHistory(id: string) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: [...areaKey(tenantId), 'purchase', id, 'history'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/purchases/{id}/history', {
          params: { header, path: { id }, query: { limit: '50' } },
        }),
      ),
  });
}
export function usePurchasePreview(
  id: string,
  condition: { id: string; version: number } | null,
  enabled: boolean,
) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: [...areaKey(tenantId), 'purchase', id, 'preview', condition],
    enabled: enabled && Boolean(condition),
    gcTime: 0,
    queryFn: () =>
      unwrap(
        api.POST('/api/v1/purchases/{id}/payment-preview', {
          params: { header, path: { id } },
          body: {
            paymentConditionId: condition!.id,
            paymentConditionVersion: condition!.version,
          },
        }),
      ),
  });
}
export function useCreatePurchase() {
  const { api, keyed } = useHeaders();
  return useCommand((body: PurchaseCreateBody, key) =>
    unwrap(api.POST('/api/v1/purchases', { params: { header: keyed(key) }, body })),
  );
}
export function useUpdatePurchase(id: string) {
  const { api, keyed } = useHeaders();
  return useCommand((body: PurchaseUpdateBody, key) =>
    unwrap(
      api.PATCH('/api/v1/purchases/{id}', { params: { header: keyed(key), path: { id } }, body }),
    ),
  );
}
export function useConfirmPurchase(id: string) {
  const { api, keyed } = useHeaders();
  return useCommand((body: PurchaseConfirmBody, key) =>
    unwrap(
      api.POST('/api/v1/purchases/{id}/confirm', {
        params: { header: keyed(key), path: { id } },
        body,
      }),
    ),
  );
}
export function useAmendPurchase(id: string) {
  const { api, keyed } = useHeaders();
  return useCommand((body: PurchaseAmendmentBody, key) =>
    unwrap(
      api.POST('/api/v1/purchases/{id}/amendments', {
        params: { header: keyed(key), path: { id } },
        body,
      }),
    ),
  );
}
export function usePurchaseDecision(id: string, action: 'cancel' | 'reopen') {
  const { api, keyed } = useHeaders();
  return useCommand((body: { expectedVersion: number; reason: string }, key) =>
    unwrap(
      action === 'cancel'
        ? api.POST('/api/v1/purchases/{id}/cancel', {
            params: { header: keyed(key), path: { id } },
            body,
          })
        : api.POST('/api/v1/purchases/{id}/reopen', {
            params: { header: keyed(key), path: { id } },
            body,
          }),
    ),
  );
}
export function useReceivePurchase(id: string) {
  const { api, keyed } = useHeaders();
  return useCommand((body: PurchaseReceiptBody, key) =>
    unwrap(
      api.POST('/api/v1/purchases/{id}/receipts', {
        params: { header: keyed(key), path: { id } },
        body,
      }),
    ),
  );
}
export function useClosurePreview(id: string, treatment: PurchaseClosureBody['treatment'] | null) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    // Fora da área: encerrar invalida a área, e a prévia de uma compra encerrada é recusada.
    queryKey: ['tenant', tenantId, 'closure-preview', id, treatment],
    enabled: Boolean(treatment),
    gcTime: 0,
    queryFn: () =>
      unwrap(
        api.POST('/api/v1/purchases/{id}/closure-preview', {
          params: { header, path: { id } },
          body: { treatment: treatment! },
        }),
      ),
  });
}
export function useClosePurchase(id: string) {
  const { api, keyed } = useHeaders();
  return useCommand((body: PurchaseClosureBody, key) =>
    unwrap(
      api.POST('/api/v1/purchases/{id}/close', {
        params: { header: keyed(key), path: { id } },
        body,
      }),
    ),
  );
}
export function usePurchaseClosure(id: string) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: [...areaKey(tenantId), 'purchase', id, 'closure'],
    queryFn: () =>
      unwrap(api.GET('/api/v1/purchases/{id}/closure', { params: { header, path: { id } } })),
  });
}
export function useReverseReceipt() {
  const { api, keyed } = useHeaders();
  return useCommand(({ id, reason }: { id: string; reason: string }, key) =>
    unwrap(
      api.POST('/api/v1/purchase-receipts/{id}/reversal', {
        params: { header: keyed(key), path: { id } },
        body: { reason },
      }),
    ),
  );
}

/* ---------- Contas a pagar ---------- */

export type PayableFilters = {
  situation: 'open' | 'overdue' | 'paid' | 'canceled' | 'all';
  originReference?: string;
  beneficiaryId?: string;
};
export function usePayables(filters: PayableFilters) {
  const { api, tenantId, header } = useTenantApi();
  return useCursorList([...areaKey(tenantId), 'payables', filters], (cursor) =>
    unwrap(
      api.GET('/api/v1/payables', {
        params: {
          header,
          query: {
            limit: '25',
            situation: filters.situation,
            ...(filters.originReference ? { originReference: filters.originReference } : {}),
            ...(filters.beneficiaryId ? { beneficiaryId: filters.beneficiaryId } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    ),
  );
}
export type SupplierCreditFilter = 'open' | 'settled' | 'all';
export function useSupplierCredits(status: SupplierCreditFilter) {
  const { api, tenantId, header } = useTenantApi();
  return useCursorList([...areaKey(tenantId), 'supplier-credits', status], (cursor) =>
    unwrap(
      api.GET('/api/v1/supplier-credits', {
        params: { header, query: { limit: '25', status, ...(cursor ? { cursor } : {}) } },
      }),
    ),
  );
}
export function useSupplierCredit(id: string) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: [...areaKey(tenantId), 'supplier-credit', id],
    queryFn: () =>
      unwrap(api.GET('/api/v1/supplier-credits/{id}', { params: { header, path: { id } } })),
  });
}
export function useSupplierCreditMovements(id: string) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: [...areaKey(tenantId), 'supplier-credit', id, 'movements'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/supplier-credits/{id}/movements', { params: { header, path: { id } } }),
      ),
  });
}
export function useApplySupplierCredit(id: string) {
  const { api, keyed } = useHeaders();
  return useCommand(
    (body: { expectedVersion: number; payableId: string; amountCents: number }, key) =>
      unwrap(
        api.POST('/api/v1/supplier-credits/{id}/applications', {
          params: { header: keyed(key), path: { id } },
          body,
        }),
      ),
  );
}
export function useRecoverSupplierCredit(id: string) {
  const { api, keyed } = useHeaders();
  return useCommand(
    (body: { expectedVersion: number; amountCents: number; recoveredOn: string }, key) =>
      unwrap(
        api.POST('/api/v1/supplier-credits/{id}/recoveries', {
          params: { header: keyed(key), path: { id } },
          body,
        }),
      ),
  );
}
export function useReverseCreditMovement() {
  const { api, keyed } = useHeaders();
  return useCommand(({ id, reason }: { id: string; reason: string }, key) =>
    unwrap(
      api.POST('/api/v1/supplier-credit-movements/{id}/reversal', {
        params: { header: keyed(key), path: { id } },
        body: { reason },
      }),
    ),
  );
}
export function usePayable(id: string) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: [...areaKey(tenantId), 'payable', id],
    queryFn: () => unwrap(api.GET('/api/v1/payables/{id}', { params: { header, path: { id } } })),
  });
}
export function usePayablePayments(id: string) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: [...areaKey(tenantId), 'payable', id, 'payments'],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/payable-payments', {
          params: { header, query: { payableId: id, limit: '100' } },
        }),
      ),
  });
}
export function useCreatePayable() {
  const { api, keyed } = useHeaders();
  return useCommand((body: PayableBody, key) =>
    unwrap(api.POST('/api/v1/payables', { params: { header: keyed(key) }, body })),
  );
}
export function useUpdatePayable(id: string) {
  const { api, keyed } = useHeaders();
  return useCommand((body: PayableUpdateBody, key) =>
    unwrap(
      api.PATCH('/api/v1/payables/{id}', { params: { header: keyed(key), path: { id } }, body }),
    ),
  );
}
export function useCancelPayable(id: string) {
  const { api, keyed } = useHeaders();
  return useCommand((body: { expectedVersion: number; reason: string }, key) =>
    unwrap(
      api.POST('/api/v1/payables/{id}/cancel', {
        params: { header: keyed(key), path: { id } },
        body,
      }),
    ),
  );
}
export function usePayPayable(id: string) {
  const { api, keyed } = useHeaders();
  return useCommand((body: PayablePaymentBody, key) =>
    unwrap(
      api.POST('/api/v1/payables/{id}/payments', {
        params: { header: keyed(key), path: { id } },
        body,
      }),
    ),
  );
}
export function useReversePayment() {
  const { api, keyed } = useHeaders();
  return useCommand(({ id, reason }: { id: string; reason: string }, key) =>
    unwrap(
      api.POST('/api/v1/payable-payments/{id}/reversal', {
        params: { header: keyed(key), path: { id } },
        body: { reason },
      }),
    ),
  );
}

/* ---------- Categorias e recorrências ---------- */

export function useExpenseCategories(enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: [...areaKey(tenantId), 'categories'],
    enabled,
    select: (page): ExpenseCategory[] => page.items,
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/expense-categories', { params: { header, query: { limit: '100' } } }),
      ),
  });
}
export function useCreateCategory() {
  const { api, keyed } = useHeaders();
  return useCommand((name: string, key) =>
    unwrap(
      api.POST('/api/v1/expense-categories', {
        params: { header: keyed(key) },
        body: { name },
      }),
    ),
  );
}
export function useSeedCategories() {
  const { api, keyed } = useHeaders();
  return useCommand((_: void, key) =>
    unwrap(api.POST('/api/v1/expense-categories/seed', { params: { header: keyed(key) } })),
  );
}
export function useRecurringExpenses() {
  const { api, tenantId, header } = useTenantApi();
  return useCursorList([...areaKey(tenantId), 'recurring'], (cursor) =>
    unwrap(
      api.GET('/api/v1/recurring-expenses', {
        params: { header, query: { limit: '50', ...(cursor ? { cursor } : {}) } },
      }),
    ),
  );
}
export function useCreateRecurring() {
  const { api, keyed } = useHeaders();
  return useCommand((body: RecurringCreateBody, key) =>
    unwrap(api.POST('/api/v1/recurring-expenses', { params: { header: keyed(key) }, body })),
  );
}
export function useUpdateRecurring() {
  const { api, keyed } = useHeaders();
  return useCommand(({ id, body }: { id: string; body: RecurringUpdateBody }, key) =>
    unwrap(
      api.PATCH('/api/v1/recurring-expenses/{id}', {
        params: { header: keyed(key), path: { id } },
        body,
      }),
    ),
  );
}
export function useRecurringCommand() {
  const { api, keyed } = useHeaders();
  return useCommand(
    (
      {
        id,
        action,
        expectedVersion,
      }: { id: string; action: 'pause' | 'resume' | 'end'; expectedVersion: number },
      key,
    ) =>
      unwrap(
        api.POST('/api/v1/recurring-expenses/{id}/commands', {
          params: { header: keyed(key), path: { id } },
          body: { action, expectedVersion },
        }),
      ),
  );
}
export function useGenerateRecurring() {
  const { api, header } = useHeaders();
  return useCommand((_: void) =>
    unwrap(api.POST('/api/v1/recurring-expenses/generate', { params: { header } })),
  );
}

/* ---------- Financeiro consolidado ---------- */

export function useManagementOverview(query: ManagementQuery) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: [...areaKey(tenantId), 'overview', query],
    staleTime: 60_000,
    retry: (count, error) =>
      count < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/finance/management', { params: { header, query }, signal })),
  });
}
export function useFinanceSettings(enabled = true) {
  const { api, tenantId, header } = useTenantApi();
  return useQuery({
    queryKey: [...areaKey(tenantId), 'settings'],
    enabled,
    queryFn: () => unwrap(api.GET('/api/v1/finance/settings', { params: { header } })),
  });
}
export function useUpdateFinanceSettings() {
  const { api, header } = useHeaders();
  return useCommand((body: FinanceSettingsInput) =>
    unwrap(api.PUT('/api/v1/finance/settings', { params: { header }, body })),
  );
}
