import { describe, expect, it } from 'vitest';
import {
  REPURCHASE,
  compareRepurchase,
  estimateRepurchase,
  median,
  shiftDate,
} from '../../src/modules/visits/repurchase.js';
import { visitSchema, visitCreate } from '../../src/shared/schemas/visits.js';
import { entitlementsFor, withinPlan } from '../../src/modules/plans/catalog.js';
import {
  permissionsFor,
  permissionMatrix,
  validateSellerOperations,
} from '../../src/modules/users/permissions.js';

const today = '2026-10-17';

describe('Estimativa de recompra', () => {
  it('usa a mediana dos intervalos entre compras confirmadas', () => {
    const days = ['2026-07-01', '2026-07-31', '2026-08-30', '2026-09-29'];
    const estimate = estimateRepurchase(days, today);
    expect(estimate).toMatchObject({
      lastPurchaseOn: '2026-09-29',
      purchaseCount: 4,
      frequencyDays: 30,
      nextEstimatedOn: '2026-10-29',
      status: 'on_track',
      daysFromEstimate: -12,
    });
  });
  it('mediana resiste a um intervalo atípico', () => {
    const days = ['2026-06-01', '2026-06-08', '2026-06-15', '2026-08-30', '2026-09-06'];
    expect(estimateRepurchase(days, today).frequencyDays).toBe(7);
  });
  it('marca estimativa vencida quando a data prevista já passou', () => {
    const estimate = estimateRepurchase(['2026-07-01', '2026-07-11', '2026-07-21'], today);
    expect(estimate.status).toBe('overdue');
    expect(estimate.nextEstimatedOn).toBe('2026-07-31');
    expect(estimate.daysFromEstimate).toBe(78);
  });
  it('sem histórico suficiente mostra só a última compra', () => {
    const estimate = estimateRepurchase(['2026-09-01', '2026-10-01'], today);
    expect(estimate).toEqual({
      lastPurchaseOn: '2026-10-01',
      purchaseCount: 2,
      frequencyDays: null,
      nextEstimatedOn: null,
      status: 'insufficient_history',
      daysFromEstimate: null,
    });
    expect(estimateRepurchase([], today).lastPurchaseOn).toBeNull();
  });
  it('vários pedidos no mesmo dia contam como uma compra', () => {
    const estimate = estimateRepurchase(['2026-10-01', '2026-10-01', '2026-10-01'], today);
    expect(estimate.purchaseCount).toBe(1);
    expect(estimate.status).toBe('insufficient_history');
  });
  it('compras fora da janela não formam frequência, mas a última compra continua visível', () => {
    const old = shiftDate(today, -REPURCHASE.lookbackDays - 10);
    const estimate = estimateRepurchase([shiftDate(old, -60), shiftDate(old, -30), old], today);
    expect(estimate.lastPurchaseOn).toBe(old);
    expect(estimate.purchaseCount).toBe(0);
    expect(estimate.status).toBe('insufficient_history');
  });
  it('usa apenas os intervalos mais recentes', () => {
    const days = Array.from({ length: 20 }, (_, i) => shiftDate('2025-11-01', i * 5));
    days.push(...Array.from({ length: 13 }, (_, i) => shiftDate('2026-04-01', i * 14)));
    expect(estimateRepurchase(days, today).frequencyDays).toBe(14);
  });
  it('mediana par arredonda a média dos centrais', () => {
    expect(median([10, 20])).toBe(15);
    expect(median([7, 8])).toBe(8);
    expect(median([3, 1, 2])).toBe(2);
  });
  it('ordena vencidas primeiro, depois as mais próximas, depois sem histórico', () => {
    const row = (customerName: string, days: string[]) => ({
      customerName,
      ...estimateRepurchase(days, today),
    });
    const sorted = [
      row('Sem histórico', ['2026-10-01']),
      row('Em dia longe', ['2026-08-01', '2026-09-01', '2026-10-01']),
      row('Vencida', ['2026-07-01', '2026-07-11', '2026-07-21']),
      row('Em dia perto', ['2026-09-01', '2026-09-11', '2026-09-21']),
    ]
      .sort(compareRepurchase)
      .map((r) => r.customerName);
    expect(sorted).toEqual(['Vencida', 'Em dia perto', 'Em dia longe', 'Sem histórico']);
  });
});

describe('Registros de visita', () => {
  const base = {
    id: 'v1',
    tenantId: 't1',
    customerId: 'c1',
    customerName: 'Cliente',
    visitDate: '2026-10-10',
    responsibleUid: 'u1',
    notes: 'Atendimento',
    createdAt: '2026-10-10T12:00:00.000Z',
    createdBy: 'u1',
    schemaVersion: 1,
  };
  it('registro automático é sempre entrega com pedido, nunca visita presencial', () => {
    const automatic = {
      ...base,
      source: 'automatic',
      kind: 'delivery',
      orderId: 'o1',
      orderCommercialId: 'PED-O1',
      payloadHash: null,
    };
    expect(visitSchema.safeParse(automatic).success).toBe(true);
    expect(visitSchema.safeParse({ ...automatic, kind: 'in_person' }).success).toBe(false);
    expect(
      visitSchema.safeParse({ ...automatic, orderId: null, orderCommercialId: null }).success,
    ).toBe(false);
  });
  it('registro manual não usa o tipo entrega e dispensa pedido', () => {
    const manual = {
      ...base,
      source: 'manual',
      kind: 'in_person',
      orderId: null,
      orderCommercialId: null,
      payloadHash: 'a'.repeat(64),
    };
    expect(visitSchema.safeParse(manual).success).toBe(true);
    expect(visitSchema.safeParse({ ...manual, kind: 'delivery' }).success).toBe(false);
    expect(
      visitCreate.safeParse({
        customerId: 'c1',
        visitDate: '2026-10-10',
        kind: 'delivery',
        notes: 'Atendimento',
      }).success,
    ).toBe(false);
  });
});

describe('Permissões e plano', () => {
  it('Essencial não recebe visitas e recompra; Profissional e contrato legado recebem', () => {
    const allowed = (planCode: 'essencial' | 'profissional' | null) =>
      withinPlan(permissionsFor('administrator'), entitlementsFor({ planCode, userLimit: 2 }));
    expect(allowed('essencial')).not.toContain('visits:own:manage');
    expect(allowed('profissional')).toContain('visits:own:manage');
    expect(allowed(null)).toContain('visits:own:manage');
    // Delivery confirmation belongs to Pedidos and exists on every plan.
    expect(allowed('essencial')).toContain('orders:own:deliver');
  });
  it('vendedor recebe as novas operações por padrão e pode tê-las retiradas', () => {
    expect(permissionsFor('seller')).toEqual(
      expect.arrayContaining(['visits:own:manage', 'orders:own:deliver']),
    );
    const visits = permissionMatrix.find((o) => o.id === 'visits.manage');
    expect(visits?.seller).toBe('default');
    expect(() => validateSellerOperations(['visits.manage'])).toThrow();
    expect(validateSellerOperations(['customers.manage', 'visits.manage'])).toEqual([
      'customers.manage',
      'visits.manage',
    ]);
    expect(permissionsFor({ role: 'seller', operations: ['customers.manage'] })).not.toContain(
      'visits:own:manage',
    );
  });
});
