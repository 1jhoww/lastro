import { z } from 'zod';
import type { Transaction } from 'firebase-admin/firestore';
import type { CommercialRepository } from '../../../infrastructure/repositories/commercialRepository.js';
import type { Book } from '../financialBook.js';
import { opaqueId, instant } from '../../../shared/schemas/models.js';
import { cents } from '../../../shared/schemas/orders.js';
import {
  paymentSchema,
  creditSchema,
  type FinancialState,
  type FinancialTitle,
} from '../../../shared/schemas/finance.js';
import { digest, stableJson } from '../../../shared/utils/crypto.js';
import { requireCondition } from '../../../shared/errors/appError.js';
import { assertDocumentFits } from '../../orders/technicalSize.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const counter = z.number().int().nonnegative().safe();
export const generationSchema = z
  .strictObject({
    id: opaqueId,
    kind: z.enum(['active', 'generation']),
    tenantId: opaqueId,
    orderId: opaqueId,
    generationId: hash,
    certified: z.boolean(),
    rowCount: counter.nullable(),
    stateVersion: counter.positive(),
    eventSequence: counter,
    headHash: hash,
    totals: z
      .array(z.strictObject({ titleId: opaqueId, cashCents: cents, creditCents: cents }))
      .min(1)
      .max(12),
    createdAt: instant,
    updatedAt: instant,
    schemaVersion: z.literal(1),
  })
  .refine(
    (v) =>
      (!v.certified || v.rowCount !== null) &&
      new Set(v.totals.map((t) => t.titleId)).size === v.totals.length,
    'Certificado de fontes inconsistente',
  );
export type SourceGeneration = z.infer<typeof generationSchema>;
export const activeSourceSchema = z.strictObject({
  id: hash,
  tenantId: opaqueId,
  orderId: opaqueId,
  customerId: opaqueId,
  generationId: hash,
  titleId: opaqueId,
  kind: z.enum(['cash', 'credit']),
  sourceId: opaqueId,
  sourceVersion: counter.positive(),
  sourceHash: hash,
  sourceTime: instant,
  remainingCents: cents.refine((v) => v > 0),
  lotId: opaqueId.nullable(),
  originEventId: opaqueId,
  proofEventId: opaqueId,
  proofEntryId: opaqueId.nullable(),
  schemaVersion: z.literal(1),
});
export type SourceChange =
  | {
      kind: 'cash';
      before: z.infer<typeof paymentSchema> | null;
      after: z.infer<typeof paymentSchema>;
    }
  | {
      kind: 'credit';
      before: z.infer<typeof creditSchema> | null;
      after: z.infer<typeof creditSchema>;
    };
export type PreparedSourceIndex = (
  tx: Transaction,
  state: FinancialState,
  titles: FinancialTitle[],
  now: string,
) => void;
export const activeGenerationId = (tenantId: string, orderId: string) =>
  digest(`active-financial-generation:${tenantId}:${orderId}`);
export const activeSourceId = (
  tenantId: string,
  generationId: string,
  kind: string,
  sourceId: string,
  titleId: string,
) =>
  digest(
    stableJson({
      domain: 'financial-active-source:v1',
      tenantId,
      generationId,
      kind,
      sourceId,
      titleId,
    }),
  );

export class SourceIndex {
  constructor(private readonly repo: CommercialRepository) {}
  async current(
    tx: Transaction,
    tenantId: string,
    orderId: string,
    state: FinancialState,
    titles: FinancialTitle[],
  ): Promise<SourceGeneration | null> {
    const id = activeGenerationId(tenantId, orderId);
    const meta = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'financialSourceGenerations', id),
      generationSchema,
      tx,
    );
    if (!meta) return null;
    requireCondition(
      meta.id === id &&
        meta.kind === 'active' &&
        meta.tenantId === tenantId &&
        meta.orderId === orderId,
      409,
      'FINANCIAL_INTEGRITY',
      'Geração financeira não pertence ao pedido',
    );
    if (meta.certified) {
      requireCondition(
        meta.stateVersion === state.version &&
          meta.eventSequence === state.eventSequence &&
          meta.headHash === state.headHash &&
          meta.rowCount !== null &&
          meta.rowCount <= state.cashSettledCents + state.creditSettledCents &&
          (meta.rowCount > 0 || state.cashSettledCents + state.creditSettledCents === 0) &&
          stableJson(meta.totals) ===
            stableJson(
              titles.map((t) => ({
                titleId: t.id,
                cashCents: t.cashCents,
                creditCents: t.creditCents,
              })),
            ),
        409,
        'FINANCIAL_INTEGRITY',
        'Certificado de fontes diverge do diário',
      );
    }
    return meta;
  }

  private baseline(book: Book): SourceGeneration {
    return (
      book.generation ??
      generationSchema.parse({
        id: activeGenerationId(book.order.tenantId, book.order.id),
        kind: 'active',
        tenantId: book.order.tenantId,
        orderId: book.order.id,
        generationId: digest(
          `financial-generation:${book.order.tenantId}:${book.order.id}:${book.state.headHash}`,
        ),
        certified: book.state.eventSequence === 0,
        rowCount: book.state.eventSequence === 0 ? 0 : null,
        stateVersion: book.state.version,
        eventSequence: book.state.eventSequence,
        headHash: book.state.headHash,
        totals: book.titles.map((t) => ({
          titleId: t.id,
          cashCents: t.cashCents,
          creditCents: t.creditCents,
        })),
        createdAt: book.order.createdAt,
        updatedAt: book.order.updatedAt,
        schemaVersion: 1,
      })
    );
  }
  private publish(
    tx: Transaction,
    baseline: SourceGeneration,
    rowDelta: number,
    state: FinancialState,
    titles: FinancialTitle[],
    now: string,
  ) {
    const meta = generationSchema.parse({
      ...baseline,
      rowCount: baseline.certified ? baseline.rowCount! + rowDelta : null,
      stateVersion: state.version,
      eventSequence: state.eventSequence,
      headHash: state.headHash,
      totals: titles.map((t) => ({
        titleId: t.id,
        cashCents: t.cashCents,
        creditCents: t.creditCents,
      })),
      updatedAt: now,
    });
    assertDocumentFits(
      this.repo.ref(meta.tenantId, 'financialSourceGenerations', meta.id).path,
      meta,
    );
    tx.set(this.repo.ref(meta.tenantId, 'financialSourceGenerations', meta.id), meta);
    tx.set(this.repo.ref(meta.tenantId, 'financialSourceGenerations', meta.generationId), {
      ...meta,
      id: meta.generationId,
      kind: 'generation',
    });
  }
  unchanged(
    tx: Transaction,
    book: Book,
    state: FinancialState,
    titles: FinancialTitle[],
    now: string,
  ) {
    if (book.generation) this.publish(tx, book.generation, 0, state, titles, now);
  }
  async prepare(
    tx: Transaction,
    book: Book,
    changes: readonly SourceChange[],
  ): Promise<PreparedSourceIndex> {
    const meta = this.baseline(book);
    const staged: {
      id: string;
      row: Omit<z.infer<typeof activeSourceSchema>, 'proofEventId'> | null;
    }[] = [];
    let rowDelta = 0;
    for (const change of changes) {
      const source = change.after;
      requireCondition(
        source.tenantId === book.order.tenantId &&
          source.orderId === book.order.id &&
          source.customerId === book.order.customerId &&
          (!change.before ||
            (change.before.id === source.id && source.version === change.before.version + 1)),
        409,
        'FINANCIAL_INTEGRITY',
        'Fonte financeira não pertence ao pedido',
      );
      const priorRows = new Map(change.before?.allocations.map((a) => [a.receivableId, a]) ?? []);
      for (const allocation of source.allocations) {
        const prior = priorRows.get(allocation.receivableId);
        const id = activeSourceId(
          meta.tenantId,
          meta.generationId,
          change.kind,
          source.id,
          allocation.receivableId,
        );
        const persisted = await this.repo.foundation.read(
          this.repo.ref(meta.tenantId, 'financialActiveSources', id),
          activeSourceSchema,
          tx,
        );
        if (meta.certified)
          requireCondition(
            prior && prior.remainingCents > 0
              ? persisted &&
                  persisted.id === id &&
                  persisted.tenantId === meta.tenantId &&
                  persisted.orderId === meta.orderId &&
                  persisted.generationId === meta.generationId &&
                  persisted.kind === change.kind &&
                  persisted.titleId === allocation.receivableId &&
                  persisted.sourceId === source.id &&
                  persisted.sourceVersion === change.before!.version &&
                  persisted.sourceHash === digest(stableJson(change.before)) &&
                  persisted.remainingCents === prior.remainingCents
              : !persisted,
            409,
            'FINANCIAL_INTEGRITY',
            'Alocação ativa diverge da fonte',
          );
        rowDelta +=
          (allocation.remainingCents > 0 ? 1 : 0) - (prior && prior.remainingCents > 0 ? 1 : 0);
        const row =
          allocation.remainingCents > 0
            ? {
                id,
                tenantId: meta.tenantId,
                orderId: meta.orderId,
                customerId: source.customerId,
                generationId: meta.generationId,
                titleId: allocation.receivableId,
                kind: change.kind,
                sourceId: source.id,
                sourceVersion: source.version,
                sourceHash: digest(stableJson(source)),
                sourceTime:
                  change.kind === 'cash' ? change.after.recordedAt : change.after.createdAt,
                remainingCents: allocation.remainingCents,
                lotId: change.kind === 'credit' ? change.after.creditLotId : null,
                originEventId: digest(`financial-event:${source.id}`),
                proofEntryId: null,
                schemaVersion: 1 as const,
              }
            : null;
        staged.push({ id, row });
      }
    }
    return (transaction, state, titles, now) => {
      requireCondition(
        state.headEventId !== null,
        409,
        'FINANCIAL_INTEGRITY',
        'Evento de projeção ausente',
      );
      for (const item of staged) {
        const ref = this.repo.ref(meta.tenantId, 'financialActiveSources', item.id);
        if (item.row) {
          const row = activeSourceSchema.parse({ ...item.row, proofEventId: state.headEventId });
          assertDocumentFits(ref.path, row);
          transaction.set(ref, row);
        } else transaction.delete(ref);
      }
      this.publish(transaction, meta, rowDelta, state, titles, now);
    };
  }
}
