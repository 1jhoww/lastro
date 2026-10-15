import type { CancellationInput, FinancialExecution, ReturnPreview, ReturnView } from '@/api/types';
import { financialResult } from './financeFixtures';
export const cancellationInput: CancellationInput = {
  expectedOrderVersion: 4,
  expectedGuardVersion: 7,
  disposition: 'customer_credit',
  reason: 'Cancelamento administrativo conferido',
};
export const execution = (o: Partial<FinancialExecution> = {}): FinancialExecution => ({
  id: 'exec1',
  orderId: 'o1',
  returnId: null,
  kind: 'cancellation',
  status: 'ACCEPTED',
  phase: 'journal',
  revision: 1,
  fencingToken: 1,
  financialCompleted: false,
  publishedAt: null,
  result: null,
  progress: {
    examined: 0,
    eligible: 0,
    planned: 0,
    sealed: 0,
    validated: 0,
    applied: 0,
    releasedReservations: 0,
    total: null,
  },
  blockedResources: { order: true, sharedLots: 0 },
  retryAfterSeconds: 0,
  review: null,
  createdAt: '2026-10-13T12:00:00.000Z',
  updatedAt: '2026-10-13T12:00:00.000Z',
  leaseUntil: new Date(Date.now() + 30000).toISOString(),
  ...o,
});
export const publishedExecution = () =>
  execution({
    status: 'COMPLETED',
    financialCompleted: true,
    publishedAt: '2026-10-13T12:00:20.000Z',
    result: financialResult,
    blockedResources: { order: false, sharedLots: 0 },
  });
export const returnPreview = (o: Partial<ReturnPreview> = {}): ReturnPreview => ({
  returnId: 'ret1',
  expectedOrderVersion: 4,
  expectedGuardVersion: 7,
  expectedVersion: 3,
  lines: [
    {
      lineId: 'line1',
      sellableQuantity: '1',
      damagedQuantity: '1',
      sellableCents: 1000,
      damagedLimitCents: 1000,
    },
  ],
  ...o,
});
export const returnView = (): ReturnView => ({
  id: 'ret1',
  orderId: 'o1',
  customerId: 'c1',
  dispatchReference: 'dispatch1',
  status: 'partially_received',
  version: 3,
  reason: 'Recebimento físico conferido',
  createdAt: '2026-10-13T12:00:00.000Z',
  updatedAt: '2026-10-13T12:00:00.000Z',
  createdBy: 'u1',
  updatedBy: 'u1',
  lines: [
    {
      lineId: 'line1',
      productId: 'prod1',
      unit: 'UN',
      requested: '3',
      received: '2',
      pending: '1',
      sellableReceived: '1',
      damagedReceived: '1',
      financialResolved: '0',
      acceptedDamaged: '0',
      rejectedDamaged: '0',
      valueResolvedCents: 0,
      damagedValueReductionCents: 0,
    },
  ],
});
