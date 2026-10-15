import { z } from 'zod';
import type { StockAdjustmentBody, StockEntryBody } from '@/api/types';
import { parseQuantityInput, toApiQuantity, type Unit } from '@/lib/quantity';
import { isFractionalUnit } from './stock';

/**
 * Formulário de entrada e de ajuste. Mesmas regras do backend: quantidade positiva, inteira para
 * UN/CX/PCT e com até 3 casas para KG/L; motivo de 3 a 200 caracteres; observação até 1000.
 * O ajuste é um delta com sinal sobre o físico ("Acrescentar" ou "Retirar").
 */

export type AdjustDirection = 'in' | 'out';

export type MovementFormValues = {
  quantity: string;
  direction: AdjustDirection;
  reason: string;
  notes: string;
};

export const emptyMovementForm: MovementFormValues = {
  quantity: '',
  direction: 'in',
  reason: '',
  notes: '',
};

export function quantityMessage(unit: Unit): string {
  return isFractionalUnit(unit)
    ? 'Use um número maior que zero com até 3 casas decimais, como 2,5.'
    : 'Use um número inteiro maior que zero para esta unidade.';
}

export function movementFormSchema(unit: Unit) {
  return z
    .object({
      quantity: z.string().trim().min(1, 'Informe a quantidade.'),
      direction: z.enum(['in', 'out']),
      reason: z
        .string()
        .trim()
        .min(3, 'Descreva o motivo com pelo menos 3 caracteres.')
        .max(200, 'Use até 200 caracteres.'),
      notes: z.string().trim().max(1000, 'Use até 1000 caracteres.'),
    })
    .superRefine((v, ctx) => {
      if (!v.quantity.trim()) return;
      const milli = parseQuantityInput(v.quantity, unit);
      if (milli === null || milli <= 0)
        ctx.addIssue({ code: 'custom', path: ['quantity'], message: quantityMessage(unit) });
    });
}

/** Quantidade digitada em milésimos (já validada pelo esquema). */
export function quantityMilli(v: MovementFormValues, unit: Unit): number {
  return parseQuantityInput(v.quantity, unit) ?? 0;
}

/** Delta com sinal aplicado ao físico. Entrada é sempre positiva. */
export function deltaMilli(v: MovementFormValues, unit: Unit, kind: 'entry' | 'adjustment') {
  const q = quantityMilli(v, unit);
  return kind === 'adjustment' && v.direction === 'out' ? -q : q;
}

const notesOf = (v: MovementFormValues) => (v.notes.trim() ? { notes: v.notes.trim() } : {});

export function toEntryBody(productId: string, v: MovementFormValues, unit: Unit): StockEntryBody {
  return {
    productId,
    quantity: toApiQuantity(quantityMilli(v, unit)),
    reason: v.reason.trim(),
    ...notesOf(v),
  };
}

/** `expectedVersion` é a versão do ESTOQUE (não a do cadastro do produto). */
export function toAdjustmentBody(
  productId: string,
  v: MovementFormValues,
  unit: Unit,
  expectedVersion: number,
): StockAdjustmentBody {
  return {
    productId,
    delta: toApiQuantity(deltaMilli(v, unit, 'adjustment')),
    expectedVersion,
    reason: v.reason.trim(),
    ...notesOf(v),
  };
}
