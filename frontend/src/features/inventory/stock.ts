import type { InventoryItem, Movement, MovementType, StockAdmin } from '@/api/types';
import { fromApiQuantity, QUANTITY_MAX_MILLI, type Unit } from '@/lib/quantity';

/**
 * Regras de apresentação do estoque. Todos os saldos chegam como texto canônico da API e são
 * lidos em milésimos inteiros: nenhuma conta usa ponto flutuante.
 */

/** Visão completa (administrador) x só disponível (vendedor), decidida pelo servidor. */
export function isAdminStock(item: InventoryItem): item is StockAdmin {
  return 'physical' in item;
}

export type StockFigures = {
  physical: number;
  reserved: number;
  available: number;
  minimum: number;
  /** Quanto falta para o disponível alcançar o mínimo (calculado pelo servidor). */
  shortfall: number;
};

export function figuresOf(s: StockAdmin): StockFigures {
  return {
    physical: fromApiQuantity(s.physical),
    reserved: fromApiQuantity(s.reserved),
    available: fromApiQuantity(s.available),
    minimum: fromApiQuantity(s.minimumStock),
    shortfall: fromApiQuantity(s.suggestedQuantity),
  };
}

/** Abaixo do mínimo quando o servidor sugere repor (disponível < mínimo). */
export const needsReplenishment = (s: StockAdmin) => fromApiQuantity(s.suggestedQuantity) > 0;

export const movementTypeLabel: Record<MovementType, string> = {
  STOCK_ENTRY: 'Entrada',
  STOCK_ADJUSTMENT_IN: 'Ajuste positivo',
  STOCK_ADJUSTMENT_OUT: 'Ajuste negativo',
  STOCK_RESERVATION: 'Reserva de pedido',
  STOCK_RESERVATION_RELEASE: 'Reserva liberada',
  STOCK_DISPATCH: 'Expedição',
  STOCK_RETURN: 'Devolução recebida',
};

export const movementTypes = Object.keys(movementTypeLabel) as MovementType[];

/** Origem legível: manual (administrador) ou automática (fluxo de pedidos e devoluções). */
export function originLabel(m: Pick<Movement, 'origin' | 'type'>): string {
  if (m.origin === 'administrative')
    return m.type === 'STOCK_ENTRY' ? 'Entrada manual' : 'Ajuste manual';
  return 'Automática (pedido)';
}

/**
 * Motivo para exibição. Movimentações automáticas guardam o próprio tipo técnico como motivo
 * ("STOCK_RESERVATION"); nesse caso não há texto escrito por alguém para mostrar.
 */
export function reasonText(m: Pick<Movement, 'reason' | 'type'>): string | null {
  return m.reason === m.type ? null : m.reason;
}

/**
 * Efeito no físico e no reservado, com sinal, a partir dos saldos antes/depois gravados pelo
 * servidor (nunca recalculado pelo tipo).
 */
export function movementEffect(m: Movement) {
  return {
    physical: fromApiQuantity(m.physical) - fromApiQuantity(m.previousPhysical),
    reserved: fromApiQuantity(m.reserved) - fromApiQuantity(m.previousReserved),
  };
}

export type BalancePreview =
  | { ok: true; physical: number; reserved: number; available: number }
  | { ok: false; reason: 'insufficient' | 'limit' | 'zero' };

/**
 * Prévia do saldo depois de uma entrada ou ajuste, com as mesmas regras do servidor:
 * o reservado não muda, o físico nunca fica abaixo do reservado (disponível ≥ 0) e não passa do
 * limite técnico. A decisão final é sempre do servidor.
 */
export function previewBalance(current: StockFigures, deltaMilli: number): BalancePreview {
  if (deltaMilli === 0) return { ok: false, reason: 'zero' };
  const physical = current.physical + deltaMilli;
  if (physical < current.reserved) return { ok: false, reason: 'insufficient' };
  if (physical > QUANTITY_MAX_MILLI) return { ok: false, reason: 'limit' };
  return { ok: true, physical, reserved: current.reserved, available: physical - current.reserved };
}

export const isFractionalUnit = (unit: Unit) => unit === 'KG' || unit === 'L';

/**
 * Início do período "últimos N dias" (hoje incluído), à meia-noite do fuso do aparelho, como
 * instante UTC — o formato que o filtro `from` do histórico aceita.
 */
export function periodStart(days: number, now = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).toISOString();
}
