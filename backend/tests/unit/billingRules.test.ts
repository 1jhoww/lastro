import { describe, it, expect } from 'vitest';
import {
  chargeId,
  chargesDue,
  dueDateFor,
  nextDueDate,
  shiftMonth,
  situationOf,
} from '../../src/modules/billing/charges.js';
import { addDays, billingDate } from '../../src/modules/billing/calendar.js';

const active = {
  status: 'active' as const,
  billingDay: 10,
  billingStartsOn: '2026-10-01',
  monthlyPriceCents: 19900,
};

describe('Datas de cobrança', () => {
  it('usa o calendário de São Paulo', () => {
    // 02:00 UTC on Oct 17 is still Oct 16 in São Paulo (UTC-3).
    expect(billingDate(new Date('2026-10-17T02:00:00.000Z'))).toBe('2026-10-16');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
  it('desloca competências entre anos', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(dueDateFor('2026-02', 28)).toBe('2026-02-28');
    expect(chargeId('sub-1', '2026-10')).toBe('sub-1_2026-10');
  });
});

describe('Geração mensal', () => {
  it('emite até 10 dias antes do vencimento', () => {
    expect(chargesDue(active, '2026-09-29')).toEqual([]);
    expect(chargesDue(active, '2026-09-30')).toEqual([
      { competence: '2026-10', dueDate: '2026-10-10' },
    ]);
    expect(chargesDue(active, '2026-10-01')).toEqual([
      { competence: '2026-10', dueDate: '2026-10-10' },
    ]);
    expect(chargesDue(active, '2026-10-31')).toEqual([
      { competence: '2026-11', dueDate: '2026-11-10' },
    ]);
  });
  it('cobre falha curta do agendador, mas não cria cobrança antiga', () => {
    expect(chargesDue(active, '2026-11-13')).toEqual([
      { competence: '2026-11', dueDate: '2026-11-10' },
    ]);
    expect(chargesDue(active, '2026-11-14')).toEqual([]);
  });
  it('nunca cobra antes do início da cobrança', () => {
    expect(chargesDue({ ...active, billingStartsOn: '2026-10-11' }, '2026-10-05')).toEqual([]);
    expect(chargesDue({ ...active, billingStartsOn: '2026-10-11' }, '2026-11-01')).toEqual([
      { competence: '2026-11', dueDate: '2026-11-10' },
    ]);
  });
  it.each([
    ['aguardando ativação', { status: 'pending' as const }],
    ['suspensa', { status: 'suspended' as const }],
    ['cancelada', { status: 'canceled' as const }],
    ['legado em atraso', { status: 'past_due' as const }],
    ['sem dia de vencimento', { billingDay: null }],
    ['sem início de cobrança', { billingStartsOn: null }],
    ['valor zero', { monthlyPriceCents: 0 }],
  ])('não gera para assinatura %s', (_label, change) => {
    expect(chargesDue({ ...active, ...change }, '2026-10-05')).toEqual([]);
  });
});

describe('Situação das cobranças', () => {
  const today = '2026-10-16';
  it.each([
    ['2026-10-15', 'pending', 'overdue'],
    ['2026-10-16', 'pending', 'due_soon'],
    ['2026-10-21', 'pending', 'due_soon'],
    ['2026-10-22', 'pending', 'pending'],
    ['2026-10-01', 'paid', 'paid'],
    ['2026-10-01', 'canceled', 'canceled'],
  ] as const)('vencimento %s com status %s é %s', (dueDate, status, expected) => {
    expect(situationOf({ dueDate, status }, today)).toBe(expected);
  });
  it('próximo vencimento respeita início e mês seguinte', () => {
    expect(nextDueDate(active, '2026-10-05')).toBe('2026-10-10');
    expect(nextDueDate(active, '2026-10-10')).toBe('2026-10-10');
    expect(nextDueDate(active, '2026-10-11')).toBe('2026-11-10');
    expect(nextDueDate({ ...active, billingStartsOn: '2026-12-15' }, '2026-10-05')).toBe(
      '2027-01-10',
    );
    expect(nextDueDate({ ...active, status: 'suspended' }, '2026-10-05')).toBeNull();
  });
});
