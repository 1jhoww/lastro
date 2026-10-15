import type {
  FinancialResult,
  FinancialState,
  MethodOption,
  ReceiptInput,
  Receivable,
} from '@/api/types';

export const receivable = (overrides: Partial<Receivable> = {}): Receivable => ({
  id: 'r1',
  orderId: 'o1',
  customerId: 'c1',
  customerName: 'Mercado Central',
  installmentNumber: 1,
  dueDate: '2026-10-01',
  originalCents: 2000,
  outstandingCents: 2000,
  cashCents: 0,
  creditCents: 0,
  canceledCents: 0,
  version: 3,
  status: 'open',
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  ...overrides,
});
export const financialState = (
  titles = [receivable()],
  overrides: Partial<FinancialState> = {},
): FinancialState => ({
  orderId: 'o1',
  orderVersion: 4,
  guardVersion: 7,
  financialVersion: 2,
  cashReceivedCents: 0,
  cashSettledCents: 0,
  creditSettledCents: 0,
  transferredCashCents: 0,
  canceledCents: 0,
  activeReturnCount: 0,
  titles,
  ...overrides,
});
export const method: MethodOption = { id: 'm1', name: 'Pix conferido', version: 5, kind: 'pix' };
export const receiptBody: ReceiptInput = {
  expectedOrderVersion: 4,
  expectedGuardVersion: 7,
  customerId: 'c1',
  methodId: 'm1',
  methodVersion: 5,
  amountCents: 500,
  receivedOn: '2026-10-13',
  allocations: [{ receivableId: 'r1', amountCents: 500, expectedVersion: 3 }],
  reason: 'Recebimento conferido',
};
export const financialResult: FinancialResult = {
  operationId: 'op1',
  orderId: 'o1',
  orderVersion: 4,
  guardVersion: 8,
  eventId: 'ev1',
  resourceId: 'p1',
  creditLotId: null,
  refundObligationId: null,
  amountCents: 500,
};
