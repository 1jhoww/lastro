import { z } from 'zod';
import type {
  CreditApplication,
  CreditLot,
  FinancialState,
  Payment,
  RefundObligation,
  MethodOption,
  OrderUpdate,
} from '@/api/types';
import { parseCalendarDate } from '@/features/orders/rules';
import type { EconomicCommand } from './commands';

export const reasonSchema = z
  .string()
  .trim()
  .min(3, 'Informe justificativa com pelo menos 3 caracteres')
  .max(500);
export const economicFormSchema = z.object({
  sourceId: z.string().min(1, 'Escolha a origem'),
  titleId: z.string(),
  amountCents: z.number().int().positive('Informe valor positivo').max(100_000_000),
  reason: reasonSchema,
  methodId: z.string(),
  date: z.string(),
  reference: z.string().trim().max(200),
  transferConfirmed: z.boolean(),
});
export type EconomicValues = z.infer<typeof economicFormSchema>;
export const emptyEconomicValues: EconomicValues = {
  sourceId: '',
  titleId: '',
  amountCents: 0,
  reason: '',
  methodId: '',
  date: '',
  reference: '',
  transferConfirmed: false,
};

/** Uma alocação escolhida, sem rateio. Valores e versões vêm exclusivamente das consultas oficiais. */
export function buildEconomicCommand(
  kind: EconomicCommand['kind'],
  values: EconomicValues,
  state: FinancialState,
  sources: {
    lots: CreditLot[];
    payments: Payment[];
    applications: CreditApplication[];
    refunds: RefundObligation[];
    methods: MethodOption[];
  },
): EconomicCommand {
  const v = economicFormSchema.parse(values);
  const versions = {
    expectedOrderVersion: state.orderVersion,
    expectedGuardVersion: state.guardVersion,
  };
  if (kind === 'confirm-refund') {
    const refund = sources.refunds.find((r) => r.id === v.sourceId && r.orderId === state.orderId);
    const method = sources.methods.find((m) => m.id === v.methodId);
    if (!refund || v.amountCents > refund.outstandingCents)
      throw new Error('Valor excede obrigação pendente');
    if (!method || !v.reference || parseCalendarDate(v.date) !== v.date || !v.transferConfirmed)
      throw new Error('Confirme transferência externa já realizada, forma, data e referência');
    return {
      kind,
      id: refund.id,
      orderId: state.orderId,
      body: {
        ...versions,
        expectedVersion: refund.version,
        amountCents: v.amountCents,
        methodId: method.id,
        methodVersion: method.version,
        refundedOn: v.date,
        reference: v.reference,
        reason: v.reason,
      },
    };
  }
  const title = state.titles.find((t) => t.id === v.titleId);
  if (!title) throw new Error('Escolha parcela oficial do pedido');
  const allocations = [
    { receivableId: title.id, amountCents: v.amountCents, expectedVersion: title.version },
  ];
  if (kind === 'apply-credit') {
    const lot = sources.lots.find((l) => l.id === v.sourceId && l.customerId === title.customerId);
    if (!lot || v.amountCents > lot.availableCents)
      throw new Error('Saldo de crédito insuficiente');
    if (v.amountCents > title.outstandingCents) throw new Error('Valor excede saldo da parcela');
    return {
      kind,
      id: state.orderId,
      orderId: state.orderId,
      body: {
        ...versions,
        customerId: title.customerId,
        creditLotId: lot.id,
        expectedLotVersion: lot.version,
        amountCents: v.amountCents,
        allocations,
        reason: v.reason,
      },
    };
  }
  const source =
    kind === 'reverse-payment'
      ? sources.payments.find((p) => p.id === v.sourceId)
      : sources.applications.find((a) => a.id === v.sourceId);
  const allocation = source?.allocations.find((a) => a.receivableId === title.id);
  if (
    !source ||
    source.orderId !== state.orderId ||
    !allocation ||
    v.amountCents > allocation.remainingCents
  )
    throw new Error('Valor excede alocação reversível');
  const base = {
    ...versions,
    expectedVersion: source.version,
    amountCents: v.amountCents,
    allocations,
    reason: v.reason,
  };
  if (kind === 'reverse-payment')
    return { kind, id: source.id, orderId: state.orderId, body: base };
  const application = source as CreditApplication;
  const lot = sources.lots.find(
    (l) => l.id === application.creditLotId && l.customerId === title.customerId,
  );
  if (!lot) throw new Error('Carregue a fonte original do crédito antes de estornar');
  return {
    kind,
    id: application.id,
    orderId: state.orderId,
    body: { ...base, expectedLotVersion: lot.version },
  };
}

export const scheduleSchema = z
  .array(
    z.object({
      offsetDays: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      weight: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    }),
  )
  .min(1)
  .max(12)
  .refine(
    (rows) => rows.every((r, i) => i === 0 || r.offsetDays >= rows[i - 1]!.offsetDays),
    'Prazos devem estar em ordem crescente',
  );
export const conditionFormSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500),
  mode: z.enum(['cash', 'net30', '30_60', '30_60_90', 'custom']),
  schedule: scheduleSchema,
  status: z.enum(['active', 'inactive']),
});
export type ConditionValues = z.infer<typeof conditionFormSchema>;
export const methodFormSchema = z.object({
  name: z.string().trim().min(2).max(100),
  kind: z.enum(['cash', 'pix', 'transfer', 'card', 'boleto', 'other']),
  status: z.enum(['active', 'inactive']),
});
export type MethodValues = z.infer<typeof methodFormSchema>;

export const discountFormSchema = z
  .object({
    type: z.enum(['fixed', 'percentage']),
    value: z.number().int().positive().max(100_000_000),
    reason: z.string().trim().min(3).max(200),
  })
  .refine(
    (v) => v.type !== 'percentage' || v.value <= 10_000,
    'Percentual máximo: 10000 pontos base (100%)',
  );
export function discountBody(
  expectedVersion: number,
  values: z.infer<typeof discountFormSchema>,
): OrderUpdate {
  return { expectedVersion, discount: discountFormSchema.parse(values) };
}
