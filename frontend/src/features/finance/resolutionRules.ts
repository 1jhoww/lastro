import { z } from 'zod';
import type {
  CancellationInput,
  FinancialExecution,
  FinancialState,
  Order,
  ReturnPreview,
  ReturnResolutionInput,
} from '@/api/types';
import { executionDone, executionPublished } from '@/features/orders/rules';
import { receiptResultSchema } from './rules';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const quantity = z.string().regex(/^\d+(?:\.\d+)?$/);
export const returnPreviewSchema = z
  .object({
    returnId: z.string().min(1),
    expectedOrderVersion: count.positive(),
    expectedGuardVersion: count.positive(),
    expectedVersion: count.positive(),
    lines: z.array(
      z.object({
        lineId: z.string().min(1),
        sellableQuantity: quantity,
        damagedQuantity: quantity,
        sellableCents: count,
        damagedLimitCents: count,
      }),
    ),
  })
  .refine((p) => new Set(p.lines.map((l) => l.lineId)).size === p.lines.length);
export const executionResponseSchema = z
  .object({
    id: z.string().min(1),
    orderId: z.string().min(1),
    returnId: z.string().nullable(),
    kind: z.enum(['cancellation', 'return_resolution']),
    status: z.enum([
      'ACCEPTED',
      'INDEXING',
      'PLANNING',
      'SEALING',
      'VALIDATING',
      'READY',
      'APPLYING',
      'FINALIZABLE',
      'PAUSED',
      'NEEDS_REVIEW',
      'COMPLETED',
      'ABORTED',
    ]),
    phase: z.enum([
      'journal',
      'payments',
      'credits',
      'lot-locks',
      'sources',
      'merkle',
      'verify',
      'stock',
      'publish',
      'return-lines',
      'final-check',
    ]),
    revision: count.positive(),
    fencingToken: count.positive(),
    financialCompleted: z.boolean(),
    publishedAt: z.string().nullable(),
    result: receiptResultSchema.nullable(),
    progress: z.object({
      examined: count,
      eligible: count,
      planned: count,
      sealed: count,
      validated: count,
      applied: count,
      releasedReservations: count,
      total: count.nullable(),
    }),
    blockedResources: z.object({ order: z.boolean(), sharedLots: count }),
    retryAfterSeconds: count,
    review: z
      .object({ code: z.string(), reference: z.string(), detectedAt: z.string() })
      .nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    leaseUntil: z.string().nullable(),
  })
  .refine(
    (e) =>
      e.progress.applied <= e.progress.validated &&
      e.progress.validated <= e.progress.sealed &&
      e.progress.sealed <= e.progress.planned &&
      (e.progress.total === null || e.progress.planned <= e.progress.total) &&
      (e.status === 'COMPLETED'
        ? executionPublished(e) && e.result?.orderId === e.orderId
        : !e.financialCompleted && e.publishedAt === null && e.result === null),
  );

export const dispositionOptions = [
  {
    value: 'customer_credit' as const,
    label: 'Crédito do cliente',
    description: 'Somente caixa liquidado gera nova fonte legítima.',
  },
  {
    value: 'refund' as const,
    label: 'Obrigação de reembolso',
    description: 'Pagamento externo continua separado e manual.',
  },
];
export const resolutionFormSchema = z.object({
  disposition: z.enum(['customer_credit', 'refund']),
  reason: z.string().trim().min(3, 'Informe justificativa com pelo menos 3 caracteres').max(500),
});
export function cancellationBody(
  order: Order,
  state: FinancialState,
  decision: Pick<CancellationInput, 'disposition' | 'reason'>,
): CancellationInput {
  if (
    order.id !== state.orderId ||
    order.version !== state.orderVersion ||
    order.status !== 'confirmed' ||
    state.activeReturnCount !== 0
  )
    throw new Error(
      'Pedido precisa estar confirmado, não expedido e sem devolução pendente. Atualize estado oficial.',
    );
  return {
    ...resolutionFormSchema.parse(decision),
    expectedOrderVersion: state.orderVersion,
    expectedGuardVersion: state.guardVersion,
  };
}
export function returnResolutionBody(
  preview: ReturnPreview,
  disposition: CancellationInput['disposition'],
  reason: string,
  decisions: NonNullable<ReturnResolutionInput['damagedDecisions']>,
): ReturnResolutionInput {
  const decision = resolutionFormSchema.parse({ disposition, reason });
  if (!returnPreviewSchema.safeParse(preview).success || !preview.lines.length)
    throw new Error('Nenhum recebido físico elegível ou preview oficial inválido.');
  const needed = preview.lines.filter((l) => Number(l.damagedQuantity) > 0);
  if (
    new Set(decisions.map((d) => d.lineId)).size !== decisions.length ||
    needed.length !== decisions.length
  )
    throw new Error('Decida explicitamente cada linha danificada elegível.');
  for (const d of decisions) {
    const line = needed.find((l) => l.lineId === d.lineId);
    if (
      !line ||
      typeof d.accept !== 'boolean' ||
      (d.acceptedCents !== undefined &&
        (!Number.isSafeInteger(d.acceptedCents) ||
          d.acceptedCents < 0 ||
          d.acceptedCents > line.damagedLimitCents ||
          (!d.accept && d.acceptedCents !== 0)))
    )
      throw new Error('Aceite de dano fora do limite oficial.');
  }
  return {
    ...decision,
    expectedOrderVersion: preview.expectedOrderVersion,
    expectedGuardVersion: preview.expectedGuardVersion,
    expectedVersion: preview.expectedVersion,
    ...(decisions.length ? { damagedDecisions: decisions } : {}),
  };
}
/** Campo applicationStartedAt é privado. Oferta conservadora; servidor decide admissibilidade final. */
export function canOfferAbort(e: FinancialExecution) {
  return (
    ['ACCEPTED', 'INDEXING', 'PLANNING', 'SEALING', 'VALIDATING', 'READY'].includes(e.status) &&
    e.progress.applied === 0 &&
    e.progress.releasedReservations === 0
  );
}
export function canAdvance(e: FinancialExecution, now = Date.now()) {
  return (
    !executionDone(e) &&
    !['PAUSED', 'NEEDS_REVIEW'].includes(e.status) &&
    !!e.leaseUntil &&
    Date.parse(e.leaseUntil) > now
  );
}

export type ReconciliationPage = {
  consistent: boolean;
  complete: boolean;
  nextCursor: string | null;
  scope?: 'journal' | 'proofs';
  checkedEvents?: number;
  checkedEntries?: number;
  expectedEntries?: number;
  orderId?: string;
  executionId?: string;
};
export function appendReconciliation(
  previous: ReconciliationPage | null,
  page: ReconciliationPage,
): ReconciliationPage {
  const checked = page.checkedEntries ?? page.checkedEvents;
  const oldChecked = previous?.checkedEntries ?? previous?.checkedEvents ?? 0;
  if (
    !Number.isSafeInteger(checked) ||
    checked! < oldChecked ||
    (page.complete ? page.nextCursor !== null : !page.nextCursor) ||
    (previous &&
      (page.scope !== previous.scope ||
        page.orderId !== previous.orderId ||
        page.executionId !== previous.executionId ||
        page.expectedEntries !== previous.expectedEntries)) ||
    (page.scope === 'proofs' &&
      (page.expectedEntries === undefined ||
        checked! > page.expectedEntries ||
        (page.complete && page.consistent && checked !== page.expectedEntries)))
  )
    throw new Error('Checkpoint de reconciliação divergente. Reinicie consulta oficial.');
  return { ...page, consistent: page.consistent && (previous?.consistent ?? true) };
}
