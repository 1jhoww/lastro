import type { BonusKind, BonusReason, BonusStatus } from '@/api/types';
import type { BadgeTone } from '@/ui';
import { fromApiQuantity, type Unit } from '@/lib/quantity';

export const reasonLabel: Record<BonusReason, string> = {
  sample: 'Amostra',
  campaign: 'Campanha comercial',
  relationship: 'Relacionamento',
  damage_replacement: 'Reposição de avaria',
  other: 'Outro',
};
export const reasonOptions = (Object.keys(reasonLabel) as BonusReason[]).map((value) => ({
  value,
  label: reasonLabel[value],
}));

export const kindLabel: Record<BonusKind, string> = { order: 'Vinculada', standalone: 'Avulsa' };

export const bonusStatusLabel: Record<BonusStatus, string> = {
  draft: 'Rascunho',
  confirmed: 'Estoque reservado',
  dispatched: 'Saiu do estoque',
  canceled: 'Cancelada',
};
export const bonusStatusTone: Record<BonusStatus, BadgeTone> = {
  draft: 'neutral',
  confirmed: 'accent',
  dispatched: 'success',
  canceled: 'danger',
};

export const eventLabel = {
  created: 'Bonificação criada',
  edited: 'Bonificação editada',
  confirmed: 'Estoque reservado com o pedido',
  dispatched: 'Saída do estoque com o pedido',
  canceled: 'Cancelada com o pedido',
  returned: 'Retorno registrado',
} as const;

/** "BON-1A2B3C4D" a partir do identificador comercial completo. */
export const shortBonusId = (commercialId: string) => commercialId.slice(0, 12);

export type BonusLineDraft = {
  productId: string;
  name: string;
  sku: string;
  unit: Unit;
  quantityMilli: number;
};

/** Ainda pode retornar: o que saiu menos o que já voltou, vendável ou danificado. */
export function returnable(line: {
  quantity: string;
  returnedSellable: string;
  returnedDamaged: string;
}) {
  return (
    fromApiQuantity(line.quantity) -
    fromApiQuantity(line.returnedSellable) -
    fromApiQuantity(line.returnedDamaged)
  );
}

export const reasonText = (bonus: { reason: BonusReason | null; reasonDetail: string | null }) =>
  bonus.reason
    ? bonus.reason === 'other' && bonus.reasonDetail
      ? `Outro: ${bonus.reasonDetail}`
      : reasonLabel[bonus.reason]
    : 'Não informado';

/** Total de unidades, todas as medidas somadas, como o relatório de bonificações. */
export const unitsOf = (lines: readonly { quantity: string }[]) =>
  lines.reduce((a, l) => a + fromApiQuantity(l.quantity), 0);

export function bonusErrorMessage(code: string): string | undefined {
  switch (code) {
    case 'INSUFFICIENT_STOCK':
      return 'Não há estoque disponível para esta quantidade. Reduza ou retire o produto.';
    case 'PRODUCT_UNAVAILABLE':
      return 'Um dos produtos foi desativado ou mudou de unidade. Retire-o e tente de novo.';
    case 'CUSTOMER_INACTIVE':
      return 'O cliente foi desativado. Escolha outro cliente.';
    case 'RESOURCE_NOT_FOUND':
      return 'Cliente ou produto não encontrado na sua carteira.';
    case 'INVALID_RESPONSIBLE':
      return 'O responsável escolhido não tem vínculo ativo na empresa.';
    case 'RETURN_LIMIT':
      return 'O retorno passa da quantidade bonificada. Atualize a tela e confira.';
    case 'CONFLICT':
      return 'A bonificação foi alterada por outra pessoa. Atualize a tela e tente de novo.';
    default:
      return undefined;
  }
}
