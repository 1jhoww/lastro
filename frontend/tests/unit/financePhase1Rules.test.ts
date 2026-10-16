import type { FinancialExecution } from '@/api/types';
import {
  addDays,
  daysBetween,
  formatIsoDate,
  maskBrDate,
  monthGrid,
  parseBrDate,
  shiftMonth,
} from '@/lib/calendar';
import {
  coveredBefore,
  receivedInMonth,
  recentPayments,
  summarizeTitles,
  upcomingTitles,
} from '@/features/finance/overview';
import {
  describeOffsets,
  describeWeights,
  dueHint,
  dueKey,
  executionStage,
  nameKey,
  orderCode,
  previewAmounts,
  previewDueDates,
} from '@/features/finance/presentation';
import { returnStage } from '@/features/finance/ReturnsScreen';
import { receivable } from '../support/financeFixtures';
import { payment } from '../support/financeBFixtures';

describe('calendário DD/MM/AAAA', () => {
  it('mostra e lê datas brasileiras sem perder AAAA-MM-DD da API', () => {
    expect(formatIsoDate('2026-10-15')).toBe('15/10/2026');
    expect(parseBrDate('15/10/2026')).toBe('2026-10-15');
    expect(parseBrDate('2026-10-15')).toBe('2026-10-15');
    expect(parseBrDate('31/02/2026')).toBeNull();
    expect(parseBrDate('15/10/26')).toBeNull();
  });
  it('máscara insere barras e aceita data colada no formato da API', () => {
    expect(maskBrDate('1')).toBe('1');
    expect(maskBrDate('1510')).toBe('15/10');
    expect(maskBrDate('15102026')).toBe('15/10/2026');
    expect(maskBrDate('15/10/20261')).toBe('15/10/2026');
    expect(maskBrDate('2026-10-15')).toBe('15/10/2026');
  });
  it('soma dias corridos e monta o mês começando no domingo', () => {
    expect(addDays('2026-10-15', 30)).toBe('2026-11-14');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-15', '2026-09-26')).toBe(-19);
    const grid = monthGrid('2026-10-15');
    expect(grid[0]!.slice(0, 4)).toEqual([null, null, null, null]);
    expect(grid[0]![4]).toBe('2026-10-01');
    expect(grid.flat().filter(Boolean)).toHaveLength(31);
    expect(shiftMonth('2026-01-20', -1)).toBe('2025-12-01');
  });
});

describe('painel financeiro: indicadores só com escopo coberto', () => {
  const today = '2026-10-15';
  const t = (id: string, dueDate: string, outstandingCents: number) =>
    receivable({ id, dueDate, outstandingCents, originalCents: Math.max(outstandingCents, 100) });
  it('leitura completa soma em aberto, vencido, hoje e próximos 7 dias', () => {
    const scan = {
      complete: true,
      items: [
        t('a', '2026-09-01', 1000),
        t('b', '2026-10-10', 0),
        t('c', '2026-10-15', 300),
        t('d', '2026-10-20', 200),
        t('e', '2026-12-01', 500),
      ],
    };
    const s = summarizeTitles(scan, today);
    expect(s.open).toEqual({ cents: 2000, count: 4 });
    expect(s.overdue).toEqual({ cents: 1000, count: 1 });
    expect(s.dueToday).toEqual({ cents: 300, count: 1 });
    expect(s.dueSoon).toEqual({ cents: 500, count: 2 });
  });
  it('leitura incompleta nunca apresenta total geral parcial como global', () => {
    const scan = { complete: false, items: [t('a', '2026-09-01', 1000), t('b', '2026-10-18', 50)] };
    const s = summarizeTitles(scan, today);
    expect(coveredBefore(scan)).toBe('2026-10-18');
    expect(s.open).toBeNull();
    // Ordem por vencimento: tudo antes de 18/10 já foi lido, então vencidos estão completos.
    expect(s.overdue).toEqual({ cents: 1000, count: 1 });
    expect(s.dueToday).toEqual({ cents: 0, count: 0 });
    expect(s.dueSoon).toBeNull();
  });
  it('leitura incompleta antes de hoje não afirma vencidos', () => {
    const s = summarizeTitles({ complete: false, items: [t('a', '2026-09-01', 1000)] }, today);
    expect(s.overdue).toBeNull();
    expect(s.open).toBeNull();
  });
  it('recebido no mês desconta estornos e exige leitura completa', () => {
    const items = [
      payment({ id: 'p1', receivedOn: '2026-10-02', amountCents: 500, reversedCents: 100 }),
      payment({ id: 'p2', receivedOn: '2026-09-30', amountCents: 900, reversedCents: 0 }),
      payment({ id: 'p3', receivedOn: '2026-10-15', amountCents: 300, reversedCents: 0 }),
    ];
    expect(receivedInMonth({ complete: true, items }, today)).toEqual({ cents: 700, count: 2 });
    expect(receivedInMonth({ complete: false, items }, today)).toBeNull();
    expect(recentPayments({ complete: true, items }).map((p) => p.id)).toEqual(['p3', 'p1', 'p2']);
  });
  it('próximos vencimentos ignoram títulos sem saldo e mantêm vencidos primeiro', () => {
    const scan = {
      complete: true,
      items: [t('a', '2026-09-01', 1000), t('b', '2026-09-10', 0), t('c', '2026-11-01', 10)],
    };
    expect(upcomingTitles(scan).map((x) => x.id)).toEqual(['a', 'c']);
  });
});

describe('apresentação do título e do cadastro', () => {
  it('diferencia vencido, vence hoje, a vencer, quitado e cancelado', () => {
    expect(dueKey(receivable({ dueDate: '2026-10-01' }), '2026-10-15')).toBe('overdue');
    expect(dueKey(receivable({ dueDate: '2026-10-15' }), '2026-10-15')).toBe('today');
    expect(dueKey(receivable({ dueDate: '2026-10-20' }), '2026-10-15')).toBe('upcoming');
    expect(
      dueKey(receivable({ outstandingCents: 0, cashCents: 2000, status: 'paid' }), '2026-10-15'),
    ).toBe('paid');
    expect(dueKey(receivable({ status: 'canceled' }), '2026-10-15')).toBe('canceled');
    expect(dueHint(receivable({ dueDate: '2026-09-26' }), '2026-10-15')).toBe('Venceu há 19 dias');
    expect(dueHint(receivable({ dueDate: '2026-10-16' }), '2026-10-15')).toBe('Vence amanhã');
  });
  it('código do pedido é o mesmo identificador curto de Pedidos', () => {
    expect(orderCode('3dd9b83f-b109-4cd4')).toBe('PED-3DD9B83F');
  });
  it('prévia de divisão segue a regra do maior resto do servidor', () => {
    expect(previewAmounts(100_000, [1, 2])).toEqual([33_333, 66_667]);
    expect(previewAmounts(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(previewAmounts(10, [1, 0])).toEqual([]);
    expect(previewAmounts(7191, [1, 1]).reduce((a, b) => a + b, 0)).toBe(7191);
    expect(previewDueDates('2026-10-15', [0, 28])).toEqual(['2026-10-15', '2026-11-12']);
  });
  it('descreve prazos e pesos sem termos técnicos', () => {
    expect(describeOffsets([0])).toBe('À vista (no dia da confirmação)');
    expect(describeOffsets([30, 60, 90])).toBe('30, 60 e 90 dias');
    expect(describeWeights([1, 1])).toBe('Partes iguais');
    expect(describeWeights([1, 3])).toBe('25% · 75%');
    expect(nameKey('  Transferência  BB ')).toBe(nameKey('transferencia bb'));
  });
  it('operação só aparece concluída com publicação econômica comprovada', () => {
    const base = { financialCompleted: false, publishedAt: null, result: null } as const;
    const stage = (e: Partial<FinancialExecution>) =>
      executionStage({ ...base, ...e } as FinancialExecution).label;
    expect(stage({ status: 'ACCEPTED' })).toBe('Aguardando continuidade');
    expect(stage({ status: 'COMPLETED' })).toBe('Aguardando confirmação');
    expect(stage({ status: 'COMPLETED', financialCompleted: true })).toBe('Aguardando confirmação');
    expect(stage({ status: 'PAUSED' })).toBe('Necessita atenção');
    expect(stage({ status: 'NEEDS_REVIEW' })).toBe('Necessita atenção');
    expect(stage({ status: 'ABORTED' })).toBe('Interrompida sem efeito');
    expect(
      stage({
        status: 'COMPLETED',
        financialCompleted: true,
        publishedAt: '2026-10-15T12:00:00Z',
        result: { operationId: 'op' } as FinancialExecution['result'],
      }),
    ).toBe('Concluída');
  });
  it('devolução distingue recebimento físico e acerto financeiro', () => {
    const line = (received: string, resolved: string) =>
      ({ received, financialResolved: resolved }) as never;
    expect(returnStage({ status: 'pending', lines: [line('0', '0')] }).label).toBe(
      'Aguardando recebimento físico',
    );
    expect(returnStage({ status: 'received', lines: [line('2', '0')] }).label).toBe(
      'Resolução financeira pendente',
    );
    expect(returnStage({ status: 'partially_received', lines: [line('1', '1')] }).label).toBe(
      'Recebida em parte · restante a receber',
    );
    expect(returnStage({ status: 'closed', lines: [line('2', '2')] }).label).toBe(
      'Resolução concluída',
    );
  });
});
