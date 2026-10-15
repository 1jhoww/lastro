import { describe, it, expect } from 'vitest';
import {
  receiptInput,
  titleAmounts,
  fundsSchema,
  titleStatus,
} from '../../src/shared/schemas/finance.js';
describe('Invariantes monetárias E', () => {
  it('título conserva valor original nos quatro componentes', () => {
    const base = {
      id: 'r',
      originalCents: 100,
      outstandingCents: 40,
      cashCents: 30,
      creditCents: 20,
      canceledCents: 10,
      version: 1,
    };
    expect(titleAmounts.safeParse(base).success).toBe(true);
    expect(titleAmounts.safeParse({ ...base, outstandingCents: 41 }).success).toBe(false);
  });
  it('caixa não pode financiar aplicação e transferência duplicadas', () => {
    const base = {
      cashReceivedCents: 100,
      cashSettledCents: 60,
      creditSettledCents: 0,
      transferredCashCents: 40,
      canceledCents: 0,
      activeReturnCount: 0,
    };
    expect(fundsSchema.safeParse(base).success).toBe(true);
    expect(fundsSchema.safeParse({ ...base, transferredCashCents: 41 }).success).toBe(false);
  });
  it('parcela zero representa ausência de saldo, não pagamento', () =>
    expect(
      titleStatus({
        originalCents: 0,
        outstandingCents: 0,
        cashCents: 0,
        creditCents: 0,
        canceledCents: 0,
      }),
    ).toBe('zero'));
  it.each([0, -1, 1.1])('nega recebimento %s', (amountCents) =>
    expect(
      receiptInput.safeParse({
        expectedOrderVersion: 1,
        expectedGuardVersion: 1,
        customerId: 'c',
        methodId: 'm',
        methodVersion: 1,
        amountCents,
        receivedOn: '2026-10-08',
        allocations: [{ receivableId: 'r', amountCents, expectedVersion: 1 }],
        reason: 'Teste',
      }).success,
    ).toBe(false),
  );
  it('nega crédito por excedente e campos de saldo externos', () => {
    const base = {
      expectedOrderVersion: 1,
      expectedGuardVersion: 1,
      customerId: 'c',
      methodId: 'm',
      methodVersion: 1,
      amountCents: 1,
      receivedOn: '2026-10-08',
      allocations: [{ receivableId: 'r', amountCents: 1, expectedVersion: 1 }],
      reason: 'Teste',
    };
    expect(receiptInput.safeParse(base).success).toBe(true);
    for (const extra of [
      { excessDestination: 'credit' },
      { outstandingCents: 10 },
      { tenantId: 't' },
      { createdBy: 'u' },
    ])
      expect(receiptInput.safeParse({ ...base, ...extra }).success).toBe(false);
  });
});
