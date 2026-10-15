import { z } from 'zod';
import type { FinancialState, MethodOption, Receivable, ReceiptInput } from '@/api/types';
import { parseCalendarDate } from '@/features/orders/rules';

export const titleLabels = {
  open: 'Em aberto',
  partially_paid: 'Parcialmente recebido',
  paid: 'Quitado',
  canceled: 'Cancelado',
  zero: 'Sem valor',
} as const;

const calendarDate = z
  .string()
  .refine((value) => parseCalendarDate(value) === value, 'Use AAAA-MM-DD válido');
export const filterSchema = z
  .object({
    orderId: z.string().trim().max(128),
    from: z.union([z.literal(''), calendarDate]),
    to: z.union([z.literal(''), calendarDate]),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Início deve vir antes do fim');

export const receiptFormSchema = z.object({
  amountCents: z
    .number()
    .int()
    .positive('Informe valor maior que zero')
    .max(Number.MAX_SAFE_INTEGER),
  methodId: z.string().min(1, 'Escolha forma de pagamento'),
  receivedOn: calendarDate,
  reference: z.string().trim().max(200),
  reason: z.string().trim().min(3, 'Informe motivo com pelo menos 3 caracteres').max(500),
});
export type ReceiptFormValues = z.infer<typeof receiptFormSchema>;

/** Resposta ilegível ou incompleta não prova confirmação do comando. */
export const receiptResultSchema = z.object({
  operationId: z.string().min(1),
  orderId: z.string().min(1),
  orderVersion: z.number().int().positive(),
  guardVersion: z.number().int().positive(),
  eventId: z.string().min(1),
  resourceId: z.string().min(1).nullable(),
  creditLotId: z.string().min(1).nullable(),
  refundObligationId: z.string().min(1).nullable(),
  amountCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

/** Somente apresenta atraso de saldo positivo; não cria estado financeiro novo. */
export function isOverdue(title: Receivable, today: string) {
  return title.outstandingCents > 0 && title.dueDate < today;
}

/** Única alocação na parcela escolhida. Servidor valida saldo, método e todas as versões. */
export function toReceiptBody(
  values: ReceiptFormValues,
  state: FinancialState,
  titleId: string,
  method: MethodOption,
): ReceiptInput {
  const v = receiptFormSchema.parse(values);
  const title = state.titles.find((t) => t.id === titleId);
  if (!title || v.amountCents > title.outstandingCents)
    throw new Error('Valor excede saldo atual da parcela');
  if (v.methodId !== method.id) throw new Error('Forma de pagamento mudou');
  return {
    expectedOrderVersion: state.orderVersion,
    expectedGuardVersion: state.guardVersion,
    customerId: title.customerId,
    methodId: method.id,
    methodVersion: method.version,
    amountCents: v.amountCents,
    receivedOn: v.receivedOn,
    allocations: [
      { receivableId: title.id, amountCents: v.amountCents, expectedVersion: title.version },
    ],
    ...(v.reference ? { reference: v.reference } : {}),
    reason: v.reason,
  };
}
