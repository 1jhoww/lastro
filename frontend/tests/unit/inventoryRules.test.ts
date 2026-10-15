import { ApiError } from '@/api/errors';
import type { Movement, StockAdmin } from '@/api/types';
import { createIntentLedger, fingerprintOf, outcomeOf, PendingIntentError } from '@/lib/intent';
import { effectText } from '@/features/inventory/MovementTable';
import {
  deltaMilli,
  emptyMovementForm,
  movementFormSchema,
  toAdjustmentBody,
  toEntryBody,
} from '@/features/inventory/movementRules';
import {
  figuresOf,
  isAdminStock,
  needsReplenishment,
  originLabel,
  periodStart,
  previewBalance,
  reasonText,
} from '@/features/inventory/stock';
import { formatQuantity, fromApiQuantity, toApiQuantity } from '@/lib/quantity';

const stock = (o: Partial<StockAdmin> = {}): StockAdmin => ({
  productId: 'p1',
  name: 'Queijo',
  sku: 'QJ',
  unit: 'KG',
  status: 'active',
  physical: '10.5',
  reserved: '2.25',
  available: '8.25',
  minimumStock: '12',
  suggestedQuantity: '3.75',
  version: 4,
  lastMovementAt: null,
  ...o,
});

describe('quantidade com sinal (delta de ajuste)', () => {
  it('converte negativos sem ponto flutuante', () => {
    expect(toApiQuantity(-1500)).toBe('-1.5');
    expect(toApiQuantity(-3000)).toBe('-3');
    expect(toApiQuantity(1)).toBe('0.001');
    expect(fromApiQuantity('-0.125')).toBe(-125);
    expect(fromApiQuantity('999999999.999')).toBe(999_999_999_999);
  });

  it('soma de frações não acumula erro (0,1 + 0,2 kg)', () => {
    const total = fromApiQuantity('0.1') + fromApiQuantity('0.2');
    expect(toApiQuantity(total)).toBe('0.3');
    expect(formatQuantity(total, 'KG')).toBe('0,3 kg');
  });
});

describe('saldos', () => {
  it('lê os três saldos e o mínimo em milésimos', () => {
    expect(figuresOf(stock())).toEqual({
      physical: 10_500,
      reserved: 2_250,
      available: 8_250,
      minimum: 12_000,
      shortfall: 3_750,
    });
  });

  it('disponível = físico − reservado, como o servidor envia', () => {
    const f = figuresOf(stock());
    expect(f.physical - f.reserved).toBe(f.available);
  });

  it('distingue visão de administrador e de vendedor', () => {
    expect(isAdminStock(stock())).toBe(true);
    expect(isAdminStock({ productId: 'p1', name: 'X', sku: 'X', unit: 'UN', available: '1' })).toBe(
      false,
    );
  });

  it('mínimo cadastrado não é saldo: repor só quando o servidor sugere', () => {
    expect(needsReplenishment(stock())).toBe(true);
    expect(needsReplenishment(stock({ suggestedQuantity: '0' }))).toBe(false);
  });
});

describe('prévia de entrada e ajuste', () => {
  const current = figuresOf(stock());

  it('entrada soma ao físico e mantém o reservado', () => {
    expect(previewBalance(current, 1_255)).toEqual({
      ok: true,
      physical: 11_755,
      reserved: 2_250,
      available: 9_505,
    });
  });

  it('retirada não pode consumir o reservado', () => {
    expect(previewBalance(current, -8_250)).toMatchObject({ ok: true, available: 0 });
    expect(previewBalance(current, -8_251)).toEqual({ ok: false, reason: 'insufficient' });
  });

  it('zero e limite técnico são recusados', () => {
    expect(previewBalance(current, 0)).toEqual({ ok: false, reason: 'zero' });
    expect(previewBalance(current, 1_000_000_000_000)).toEqual({ ok: false, reason: 'limit' });
  });
});

describe('formulário de movimentação', () => {
  const values = (o: Partial<typeof emptyMovementForm>) => ({ ...emptyMovementForm, ...o });

  it('UN, CX e PCT aceitam só inteiros', () => {
    for (const unit of ['UN', 'CX', 'PCT'] as const) {
      const schema = movementFormSchema(unit);
      expect(schema.safeParse(values({ quantity: '3', reason: 'Nota 1' })).success).toBe(true);
      expect(schema.safeParse(values({ quantity: '1,5', reason: 'Nota 1' })).success).toBe(false);
    }
  });

  it('KG e L aceitam até três casas', () => {
    for (const unit of ['KG', 'L'] as const) {
      const schema = movementFormSchema(unit);
      expect(schema.safeParse(values({ quantity: '1,255', reason: 'Nota 1' })).success).toBe(true);
      expect(schema.safeParse(values({ quantity: '1,2555', reason: 'Nota 1' })).success).toBe(
        false,
      );
    }
  });

  it('quantidade zero, texto e motivo curto são recusados', () => {
    const schema = movementFormSchema('UN');
    expect(schema.safeParse(values({ quantity: '0', reason: 'Nota 1' })).success).toBe(false);
    expect(schema.safeParse(values({ quantity: 'abc', reason: 'Nota 1' })).success).toBe(false);
    expect(schema.safeParse(values({ quantity: '1', reason: 'ab' })).success).toBe(false);
    expect(schema.safeParse(values({ quantity: '1', reason: 'x'.repeat(201) })).success).toBe(
      false,
    );
  });

  it('entrada envia texto canônico; observação vazia não vai', () => {
    expect(toEntryBody('p1', values({ quantity: '1,250', reason: ' NF 9 ' }), 'KG')).toEqual({
      productId: 'p1',
      quantity: '1.25',
      reason: 'NF 9',
    });
  });

  it('ajuste envia delta com sinal e a versão do ESTOQUE', () => {
    const v = values({ quantity: '2', direction: 'out', reason: 'Avaria', notes: 'caixa molhada' });
    expect(deltaMilli(v, 'UN', 'adjustment')).toBe(-2_000);
    expect(deltaMilli(v, 'UN', 'entry')).toBe(2_000);
    expect(toAdjustmentBody('p1', v, 'UN', 7)).toEqual({
      productId: 'p1',
      delta: '-2',
      expectedVersion: 7,
      reason: 'Avaria',
      notes: 'caixa molhada',
    });
  });
});

describe('idempotência por intenção', () => {
  const body = { productId: 'p1', quantity: '5', reason: 'NF 1' };

  it('mesma intenção reutiliza a chave; conteúdo novo gera outra', () => {
    const ledger = createIntentLedger();
    const k1 = ledger.keyFor('s', body);
    expect(ledger.keyFor('s', { reason: 'NF 1', quantity: '5', productId: 'p1' })).toBe(k1);
    const k2 = ledger.keyFor('s', { ...body, quantity: '6' });
    expect(k2).not.toBe(k1);
  });

  it('resultado desconhecido bloqueia chave nova até repetir ou descartar', () => {
    const ledger = createIntentLedger();
    const k1 = ledger.keyFor('s', body);
    ledger.markUnknown('s');
    expect(ledger.keyFor('s', body)).toBe(k1);
    expect(() => ledger.keyFor('s', { ...body, quantity: '6' })).toThrow(PendingIntentError);
    ledger.clear('s');
    expect(ledger.keyFor('s', { ...body, quantity: '6' })).not.toBe(k1);
  });

  it('recusa definitiva libera nova intenção; confirmação limpa a chave', () => {
    const ledger = createIntentLedger();
    const k1 = ledger.keyFor('s', body);
    ledger.markUnknown('s');
    ledger.markRejected('s');
    expect(ledger.keyFor('s', { ...body, quantity: '7' })).not.toBe(k1);
    ledger.clear('s');
    expect(ledger.get('s')).toBeUndefined();
  });

  it('escopos diferentes (empresa, produto, tipo) não compartilham chave', () => {
    const ledger = createIntentLedger();
    expect(ledger.keyFor('u1:t1:entry:p1', body)).not.toBe(ledger.keyFor('u1:t2:entry:p1', body));
  });

  it('impressão digital ignora a ordem dos campos', () => {
    expect(fingerprintOf({ a: 1, b: 2 })).toBe(fingerprintOf({ b: 2, a: 1 }));
  });

  it('classifica recusa x resultado desconhecido', () => {
    expect(outcomeOf(new ApiError(0, 'NETWORK_ERROR', 'x')).status).toBe('unknown');
    expect(outcomeOf(new TypeError('Network request failed')).status).toBe('unknown');
    expect(outcomeOf(new ApiError(503, 'UNAVAILABLE', 'x')).status).toBe('unknown');
    expect(outcomeOf(new ApiError(409, 'CONFLICT', 'x')).status).toBe('rejected');
    expect(outcomeOf(new ApiError(409, 'INSUFFICIENT_STOCK', 'x')).status).toBe('rejected');
    expect(outcomeOf(new ApiError(422, 'INVALID_PRECISION', 'x')).status).toBe('rejected');
    expect(outcomeOf(new ApiError(403, 'FORBIDDEN', 'x')).status).toBe('rejected');
  });
});

describe('histórico', () => {
  const movement = (o: Partial<Movement>): Movement => ({
    id: 'm1',
    productId: 'p1',
    type: 'STOCK_ENTRY',
    unit: 'UN',
    sequence: 1,
    origin: 'administrative',
    originReference: '00000000-0000-4000-8000-000000000001',
    actorUid: 'u1',
    reason: 'NF 1',
    notes: null,
    occurredAt: '2026-10-10T12:00:00.000Z',
    requestId: '00000000-0000-4000-8000-000000000002',
    operationId: 'a'.repeat(64),
    quantity: '5',
    previousPhysical: '0',
    physical: '5',
    previousReserved: '0',
    reserved: '0',
    ...o,
  });

  it('efeito vem dos saldos antes/depois gravados', () => {
    expect(effectText(movement({}))).toBe('+5 un');
    expect(
      effectText(movement({ type: 'STOCK_ADJUSTMENT_OUT', previousPhysical: '5', physical: '3' })),
    ).toBe('−2 un');
    expect(
      effectText(
        movement({
          type: 'STOCK_RESERVATION',
          origin: 'order',
          previousPhysical: '5',
          physical: '5',
          reserved: '4',
        }),
      ),
    ).toBe('+4 un reservado');
  });

  it('diferencia manual e automática; motivo técnico não é exibido como texto', () => {
    expect(originLabel({ origin: 'administrative', type: 'STOCK_ENTRY' })).toBe('Entrada manual');
    expect(originLabel({ origin: 'administrative', type: 'STOCK_ADJUSTMENT_IN' })).toBe(
      'Ajuste manual',
    );
    expect(originLabel({ origin: 'order', type: 'STOCK_DISPATCH' })).toBe('Automática (pedido)');
    expect(reasonText({ reason: 'STOCK_DISPATCH', type: 'STOCK_DISPATCH' })).toBeNull();
    expect(reasonText({ reason: 'NF 1', type: 'STOCK_ENTRY' })).toBe('NF 1');
  });

  it('período começa à meia-noite local e sai em UTC aceito pelo servidor', () => {
    const now = new Date(2026, 9, 13, 15, 30);
    const from = periodStart(7, now);
    expect(from).toMatch(/T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(from).getTime()).toBe(new Date(2026, 9, 7).getTime());
  });
});
