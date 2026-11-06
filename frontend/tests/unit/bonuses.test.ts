import type { Order } from '@/api/types';
import {
  bonusErrorMessage,
  reasonLabel,
  reasonText,
  returnable,
  shortBonusId,
  unitsOf,
} from '@/features/bonuses/presentation';
import { bonusFromOrder, bonusInput } from '@/features/orders/rules';
import { originLabel } from '@/features/inventory/stock';
import { visibleDestinations } from '@/navigation/destinations';

const line = {
  id: 'l1',
  productId: 'p1',
  name: 'Ração',
  sku: 'R-1',
  unit: 'UN' as const,
  quantity: '3',
  returnedSellable: '0',
  returnedDamaged: '0',
};
const saved = {
  bonus: {
    id: 'o1',
    commercialId: 'BON-1A2B3C4D-AAAA',
    status: 'draft' as const,
    lines: [line],
    reason: 'campaign' as const,
    reasonDetail: null,
  },
} as unknown as Order;

describe('bonificação no pedido', () => {
  it('não envia nada quando a bonificação não mudou', () => {
    expect(bonusInput(saved, bonusFromOrder(saved), 'campaign', null)).toEqual({});
    expect(bonusInput(undefined, [], null, null)).toEqual({});
  });
  it('envia só o que mudou e remove com lista vazia', () => {
    expect(bonusInput(saved, [{ productId: 'p1', quantityMilli: 5000 }], 'campaign', null)).toEqual(
      {
        bonus: {
          lines: [{ productId: 'p1', quantity: '5' }],
          reason: 'campaign',
          reasonDetail: null,
        },
      },
    );
    expect(bonusInput(saved, [], null, null)).toEqual({ bonus: null });
    expect(bonusInput(undefined, [{ productId: 'p2', quantityMilli: 1000 }], null, null)).toEqual({
      bonus: { lines: [{ productId: 'p2', quantity: '1' }], reason: null, reasonDetail: null },
    });
  });
  it('descarta descrição de motivo que não é Outro', () => {
    const body = bonusInput(undefined, [{ productId: 'p', quantityMilli: 1000 }], 'sample', 'x');
    expect(body).toMatchObject({ bonus: { reason: 'sample', reasonDetail: null } });
  });
});

describe('apresentação', () => {
  it('calcula o que ainda pode retornar', () => {
    expect(returnable({ ...line, returnedSellable: '1', returnedDamaged: '1' })).toBe(1000);
  });
  it('mostra número curto, unidades e motivo', () => {
    expect(shortBonusId('BON-1A2B3C4D-AAAA')).toBe('BON-1A2B3C4D');
    expect(unitsOf([line, { ...line, quantity: '1.5' }])).toBe(4500);
    expect(reasonText({ reason: 'other', reasonDetail: 'Feira' })).toBe('Outro: Feira');
    expect(reasonText({ reason: null, reasonDetail: null })).toBe('Não informado');
    expect(reasonLabel.damage_replacement).toBe('Reposição de avaria');
  });
  it('traduz estoque insuficiente', () => {
    expect(bonusErrorMessage('INSUFFICIENT_STOCK')).toContain('estoque disponível');
    expect(bonusErrorMessage('OUTRO')).toBeUndefined();
  });
  it('identifica a origem da movimentação', () => {
    expect(originLabel({ origin: 'bonus', type: 'STOCK_BONUS_OUT' })).toBe(
      'Automática (bonificação)',
    );
  });
});

describe('navegação', () => {
  const keys = (permissions: string[]) => visibleDestinations(permissions).map((d) => d.key);
  it('só aparece para quem pode conceder', () => {
    expect(keys(['orders:own:read'])).not.toContain('bonificacoes');
    expect(keys(['orders:own:read', 'bonuses:grant'])).toContain('bonificacoes');
  });
  it('fica fora da barra principal do celular: Novo pedido segue como ação principal', () => {
    const entry = visibleDestinations(['bonuses:grant']).find((d) => d.key === 'bonificacoes');
    expect(entry?.primaryOnMobile).toBeFalsy();
  });
});
