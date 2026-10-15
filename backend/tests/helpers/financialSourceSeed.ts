import { randomUUID } from 'node:crypto';
import type { DocumentReference } from 'firebase-admin/firestore';
import type { Fixture } from './fixture.js';
import type { financialOrder } from './finance.js';
import { FoundationRepository } from '../../src/infrastructure/repositories/foundationRepository.js';
import { CommercialRepository } from '../../src/infrastructure/repositories/commercialRepository.js';
import { FinancialBook, financialEventHash } from '../../src/modules/finance/financialBook.js';
import { financialOperationSchema } from '../../src/modules/finance/financialCommands.js';
import {
  activeGenerationId,
  activeSourceId,
  activeSourceSchema,
  generationSchema,
} from '../../src/modules/finance/resolution/sourceIndex.js';
import * as s from '../../src/shared/schemas/finance.js';
import { financialGuardSchema } from '../../src/modules/receivables/orderReceivables.js';
import { methodSnapshot } from '../../src/shared/schemas/paymentSettings.js';
import { auditSchema } from '../../src/shared/schemas/models.js';
import { companyDate } from '../../src/modules/orders/calculation.js';
import { digest, stableJson } from '../../src/shared/utils/crypto.js';

/** Builds a deterministic financial history in demo fixtures, not receipt HTTP traffic. */
export async function seedValidFinancialSources(
  f: Fixture,
  setup: Awaited<ReturnType<typeof financialOrder>>,
  count: number,
) {
  if (
    f.config.projectId !== 'demo-lastro-tests' ||
    process.env.FIREBASE_PROJECT_ID !== 'demo-lastro-tests' ||
    process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' ||
    process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9199' ||
    f.firebase.bucket.name !== 'demo-lastro-tests.appspot.com'
  )
    throw new Error('Seed financeiro permitido somente nas fixtures locais demo-lastro-tests');
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error('Quantidade de fontes da fixture inválida');
  const foundation = new FoundationRepository(f.firebase.db);
  const repo = new CommercialRepository(foundation, f.config.invitationSecret);
  const ledger = new FinancialBook(repo);
  const tenantId = f.tenantA.tenant.id;
  const book = await f.firebase.db.runTransaction((tx) =>
    ledger.load(tx, tenantId, setup.order.id),
  );
  if (
    book.state.eventSequence !== 0 ||
    book.guard.paymentCount !== 0 ||
    book.state.activeReturnCount !== 0 ||
    book.titles.length !== 1 ||
    book.titles[0]!.outstandingCents < count ||
    book.titles[0]!.cashCents !== 0 ||
    book.titles[0]!.creditCents !== 0
  )
    throw new Error('Fixture exige pedido sem histórico, uma parcela e saldo suficiente');

  const now = new Date(Date.now() + f.offset).toISOString();
  const receivedOn = companyDate(new Date(now), f.tenantA.tenant.timezone);
  const generationId = digest(`financial-source-fixture:${tenantId}:${setup.order.id}`);
  const metrics = {
    sources: count,
    receiptHttpCalls: 0,
    seededEvents: count,
    seededOperations: count,
    seededAudits: count,
    activeRows: count,
    seedCommits: 0,
    maxBatchWrites: 0,
    maxBatchEstimatedBytes: 0,
    maxDocumentEstimatedBytes: 0,
    maxSampledHeapBytes: 0,
    maxSampledRssBytes: 0,
    elapsedMs: 0,
  };
  const started = performance.now();
  let state = book.state,
    title = book.titles[0]!,
    guard = book.guard;
  let batch = f.firebase.db.batch(),
    batchWrites = 0,
    batchBytes = 0;
  const stage = (ref: DocumentReference, value: Record<string, unknown>) => {
    const bytes = Buffer.byteLength(stableJson(value), 'utf8');
    if (bytes > 256 * 1024) throw new Error('Documento de fixture financeira excede orçamento');
    metrics.maxDocumentEstimatedBytes = Math.max(metrics.maxDocumentEstimatedBytes, bytes);
    batch.create(ref, value);
    batchWrites++;
    batchBytes += bytes;
  };
  const flush = async () => {
    if (batchWrites === 0) return;
    if (batchWrites > 100 || batchBytes >= 2 * 1024 * 1024)
      throw new Error('Lote de fixture financeira excede orçamento');
    await batch.commit();
    metrics.seedCommits++;
    metrics.maxBatchWrites = Math.max(metrics.maxBatchWrites, batchWrites);
    metrics.maxBatchEstimatedBytes = Math.max(metrics.maxBatchEstimatedBytes, batchBytes);
    const memory = process.memoryUsage();
    metrics.maxSampledHeapBytes = Math.max(metrics.maxSampledHeapBytes, memory.heapUsed);
    metrics.maxSampledRssBytes = Math.max(metrics.maxSampledRssBytes, memory.rss);
    batch = f.firebase.db.batch();
    batchWrites = 0;
    batchBytes = 0;
  };

  for (let index = 0; index < count; index++) {
    const key = randomUUID(),
      operationId = digest(`finance:${key}`);
    const eventId = digest(`financial-event:${operationId}`),
      requestId = randomUUID();
    const input = {
      customerId: book.order.customerId!,
      methodId: setup.method.id,
      methodVersion: setup.method.version,
      expectedOrderVersion: book.order.version,
      expectedGuardVersion: guard.version,
      amountCents: 1,
      receivedOn,
      allocations: [{ receivableId: title.id, amountCents: 1, expectedVersion: title.version }],
      reason: 'Recebimento da fixture estrutural F02',
    };
    s.receiptInput.parse(input);
    const payment = s.paymentSchema.parse({
      id: operationId,
      tenantId,
      orderId: book.order.id,
      customerId: book.order.customerId,
      amountCents: 1,
      reversedCents: 0,
      transferredCents: 0,
      allocations: [{ receivableId: title.id, amountCents: 1, remainingCents: 1 }],
      method: methodSnapshot.parse(setup.method),
      receivedOn,
      recordedAt: now,
      createdBy: f.ownerA.uid,
      reference: '',
      version: 1,
      schemaVersion: 1,
    });
    const nextTitle = s.titleSchema.parse({
      ...title,
      outstandingCents: title.outstandingCents - 1,
      cashCents: title.cashCents + 1,
      version: title.version + 1,
      updatedAt: now,
    });
    const nextState = {
      ...state,
      cashReceivedCents: state.cashReceivedCents + 1,
      cashSettledCents: state.cashSettledCents + 1,
    };
    const content = {
      id: eventId,
      tenantId,
      orderId: book.order.id,
      customerId: book.order.customerId!,
      operationId,
      type: 'receipt' as const,
      amountCents: 1,
      reason: input.reason,
      actorUid: f.ownerA.uid,
      occurredAt: now,
      requestId,
      sequence: state.eventSequence + 1,
      previousHash: state.headHash,
      before: ledger.snapshot(state, [title]),
      after: ledger.snapshot(nextState, [nextTitle]),
      references: [operationId],
      schemaVersion: 1 as const,
    };
    const event = s.eventV1Schema.parse({ ...content, hash: financialEventHash(content) });
    const nextGuard = financialGuardSchema.parse({
      ...guard,
      receivedCents: guard.receivedCents + 1,
      paymentCount: guard.paymentCount + 1,
      version: guard.version + 1,
    });
    const result = s.financialResult.parse({
      operationId,
      orderId: book.order.id,
      orderVersion: book.order.version,
      guardVersion: nextGuard.version,
      eventId,
      resourceId: operationId,
      creditLotId: null,
      refundObligationId: null,
      amountCents: 1,
    });
    const operation = financialOperationSchema.parse({
      actorUid: f.ownerA.uid,
      action: 'receipt',
      resourceId: book.order.id,
      payloadHash: digest(stableJson({ action: 'receipt', resourceId: book.order.id, input })),
      result,
      createdAt: now,
      schemaVersion: 1,
    });
    const auditId = randomUUID();
    const audit = auditSchema.parse({
      id: auditId,
      actorUid: f.ownerA.uid,
      tenantId,
      action: 'finance.receipt',
      resourceId: book.order.id,
      requestId,
      occurredAt: now,
      changes: { operationId, eventId, amountCents: 1, reason: input.reason },
      schemaVersion: 1,
    });
    const row = activeSourceSchema.parse({
      id: activeSourceId(tenantId, generationId, 'cash', operationId, title.id),
      tenantId,
      orderId: book.order.id,
      customerId: book.order.customerId,
      generationId,
      titleId: title.id,
      kind: 'cash',
      sourceId: operationId,
      sourceVersion: 1,
      sourceHash: digest(stableJson(payment)),
      sourceTime: now,
      remainingCents: 1,
      lotId: null,
      originEventId: eventId,
      proofEventId: eventId,
      proofEntryId: null,
      schemaVersion: 1,
    });
    stage(repo.ref(tenantId, 'payments', operationId), payment);
    stage(repo.ref(tenantId, 'financialEvents', eventId), event);
    stage(repo.ref(tenantId, 'financialOperations', operationId), operation);
    stage(foundation.tenant(tenantId, 'auditLogs', auditId), audit);
    stage(repo.ref(tenantId, 'financialActiveSources', row.id), row);
    state = s.financialStateSchema.parse({
      ...nextState,
      version: state.version + 1,
      eventSequence: event.sequence,
      headHash: event.hash,
      headEventId: event.id,
    });
    title = nextTitle;
    guard = nextGuard;
    if (batchWrites === 100) await flush();
  }
  await flush();
  const meta = generationSchema.parse({
    id: activeGenerationId(tenantId, book.order.id),
    kind: 'active',
    tenantId,
    orderId: book.order.id,
    generationId,
    certified: true,
    rowCount: count,
    stateVersion: state.version,
    eventSequence: state.eventSequence,
    headHash: state.headHash,
    totals: [{ titleId: title.id, cashCents: count, creditCents: 0 }],
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
  });
  const final = f.firebase.db.batch();
  final.set(repo.ref(tenantId, 'financialOrderStates', book.order.id), state);
  final.set(repo.ref(tenantId, 'financialTitles', title.id), title);
  final.set(repo.ref(tenantId, 'orderFinancialGuards', book.order.id), guard);
  final.set(repo.ref(tenantId, 'financialSourceGenerations', meta.id), meta);
  final.set(
    repo.ref(tenantId, 'financialSourceGenerations', generationId),
    generationSchema.parse({ ...meta, id: generationId, kind: 'generation' }),
  );
  await final.commit();
  metrics.seedCommits++;
  metrics.elapsedMs = Math.round(performance.now() - started);
  return metrics;
}
