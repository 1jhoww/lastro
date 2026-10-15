import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { registerFixture } from '../helpers/fixture.js';
import { draft, confirm, command, orderDocs, orderHeaders } from '../helpers/orders.js';
import { stockProduct, enter, balance } from '../helpers/inventory.js';
import { financePost, versions } from '../helpers/finance.js';
import { orderView } from '../../src/shared/schemas/orders.js';
import * as r from '../../src/shared/schemas/returns.js';
import * as s from '../../src/shared/schemas/finance.js';
import { financialGuardSchema } from '../../src/modules/receivables/orderReceivables.js';
import { returnEventHash } from '../../src/modules/returns/returnService.js';
import { financialEventHash } from '../../src/modules/finance/financialBook.js';
import { digest, stableJson } from '../../src/shared/utils/crypto.js';
import {
  sealSourceProof,
  compactHeaderHash,
  proofManifestHash,
  returnResolutionHeaderSchema,
} from '../../src/modules/finance/resolution/proofRecords.js';
import { proofLeafHash, proofRootHash } from '../../src/modules/finance/resolution/proofs.js';

const f = registerFixture();
async function publishedPartialReturn() {
  const productId = await stockProduct(f, { priceCents: 100 });
  await enter(f, productId, '2').expect(201);
  const order = orderView.parse(
    (
      await command(
        f,
        await confirm(f, await draft(f, f.ownerA, { productId, quantity: '2' })),
        'dispatch',
      ).expect(200)
    ).body.data,
  );
  const intent = (
    await financePost(f, `/orders/${order.id}/returns`, {
      ...(await versions(f, order)),
      lines: [{ lineId: order.lines[0]!.id, quantity: '2' }],
      reason: 'Intenção local',
    }).expect(201)
  ).body.data;
  await financePost(f, `/returns/${intent.returnId}/receipts`, {
    ...(await versions(f, order)),
    expectedVersion: intent.returnVersion,
    reason: 'Recebimento físico local',
    lines: [{ lineId: order.lines[0]!.id, sellableQuantity: '1' }],
  }).expect(200);
  const before = r.returnSchema.parse(
    (await orderDocs(f, 'returns').doc(intent.returnId).get()).data(),
  );
  const guardId = digest(`return-line:${f.tenantA.tenant.id}:${order.id}:${order.lines[0]!.id}`);
  const guard = r.returnGuardSchema.parse(
    (await orderDocs(f, 'orderReturnLines').doc(guardId).get()).data(),
  );
  const state = s.financialStateSchema.parse(
    (await orderDocs(f, 'financialOrderStates').doc(order.id).get()).data(),
  );
  const financialGuard = financialGuardSchema.parse(
    (await orderDocs(f, 'orderFinancialGuards').doc(order.id).get()).data(),
  );
  const title = s.titleSchema.parse(
    (await orderDocs(f, 'financialTitles').doc(order.installments[0]!.id).get()).data(),
  );
  const tenantId = f.tenantA.tenant.id,
    executionId = 'local-return-execution';
  const now = new Date().toISOString(),
    requestId = 'bce0d137-93ea-466c-976a-31b36305cac6';
  const eventId = digest('local-final-financial-event'),
    returnEventId = digest('local-final-return-event');
  const lineAfter = r.returnLineSchema.parse({
    ...before.lines[0]!,
    resolvedSellableScaled: 1000,
    valueResolvedCents: 100,
  });
  const guardAfter = r.returnGuardSchema.parse({
    ...guard,
    resolvedSellableScaled: 1000,
    valueResolvedCents: 100,
    version: guard.version + 1,
    lastEventId: returnEventId,
  });
  const entry = sealSourceProof({
    tenantId,
    executionId,
    collection: 'orderReturnLines',
    sourceId: guard.id,
    returnId: before.id,
    lineBefore: before.lines[0]!,
    lineAfter,
    before: guard,
    after: guardAfter,
    fence: 1,
    position: 0,
  });
  const context = { tenantId, executionId, entryCount: 1 };
  const rootHash = proofRootHash(context, proofLeafHash(context, 0, entry.hash));
  const after = r.returnSchema.parse({
    ...before,
    lines: [lineAfter],
    version: before.version + 1,
    updatedAt: now,
    updatedBy: f.ownerA.uid,
    reason: 'Resolução financeira local',
    eventSequence: before.eventSequence + 1,
    headEventId: returnEventId,
    headHash: digest('pending'),
  });
  const header = returnResolutionHeaderSchema.parse({
    tenantId,
    orderId: order.id,
    returnId: before.id,
    executionId,
    sourceHash: digest(stableJson(before)),
    sourceVersion: before.version,
    version: after.version,
    status: after.status,
    reason: after.reason,
    updatedAt: now,
    updatedBy: f.ownerA.uid,
    eventSequence: after.eventSequence,
    headHash: after.headHash,
    headEventId: returnEventId,
    lineCount: 1,
    schemaVersion: 1,
  });
  const returnBody = {
    id: returnEventId,
    tenantId,
    orderId: order.id,
    returnId: before.id,
    operationId: executionId,
    type: 'resolved' as const,
    sequence: after.eventSequence,
    previousHash: before.headHash,
    actorUid: f.ownerA.uid,
    occurredAt: now,
    reason: after.reason,
    requestId,
    schemaVersion: 2 as const,
    executionId,
    manifestId: executionId,
    rootHash,
    entryCount: 1,
    lineCount: 1,
    beforeSnapshotHash: digest(stableJson(r.returnSnapshotSchema.parse(before))),
    afterSnapshotHash: digest(stableJson(r.returnSnapshotSchema.parse(after))),
    headerHash: compactHeaderHash(header),
  };
  const returnEvent = r.returnEventV2Schema.parse({
    ...returnBody,
    hash: returnEventHash(returnBody),
  });
  header.headHash = returnEvent.hash;
  const nextTitle = s.titleSchema.parse({
    ...title,
    outstandingCents: 100,
    canceledCents: 100,
    version: title.version + 1,
    updatedAt: now,
  });
  const beforeLedger = s.ledgerSnapshot.parse({ ...state, titles: [s.titleAmounts.parse(title)] });
  const afterLedger = s.ledgerSnapshot.parse({
    ...state,
    canceledCents: 100,
    titles: [s.titleAmounts.parse(nextTitle)],
  });
  const proof = {
    ...context,
    manifestId: executionId,
    rootHash,
    beforeSnapshotHash: digest(stableJson(beforeLedger)),
    afterSnapshotHash: digest(stableJson(afterLedger)),
    returnEventId,
    returnEventHash: returnEvent.hash,
    returnHeaderHash: compactHeaderHash(header),
  };
  const eventBody = {
    id: eventId,
    tenantId,
    orderId: order.id,
    customerId: order.customerId!,
    operationId: executionId,
    type: 'return_resolved' as const,
    amountCents: 100,
    reason: after.reason,
    actorUid: f.ownerA.uid,
    occurredAt: now,
    requestId,
    sequence: state.eventSequence + 1,
    previousHash: state.headHash,
    before: beforeLedger,
    after: afterLedger,
    references: [before.id, returnEventId],
    schemaVersion: 2 as const,
    proof: {
      executionId,
      manifestId: executionId,
      rootHash,
      entryCount: 1,
      beforeSnapshotHash: proof.beforeSnapshotHash,
      afterSnapshotHash: proof.afterSnapshotHash,
      returnEventId,
      returnEventHash: proof.returnEventHash,
      returnHeaderHash: proof.returnHeaderHash,
    },
  };
  const event = s.eventV2Schema.parse({ ...eventBody, hash: financialEventHash(eventBody) });
  const { manifestId: _manifestId, ...manifestBody } = proof;
  const manifestContent = { ...manifestBody, orderId: order.id, schemaVersion: 1 as const };
  const manifest = { ...manifestContent, hash: proofManifestHash(manifestContent) };
  const base = f.firebase.db.doc(`tenants/${tenantId}`);
  const root = {
    id: executionId,
    tenantId,
    orderId: order.id,
    status: 'APPLYING',
    proofRootHash: rootHash,
    proofEntryCount: 1,
    publication: null,
  };
  await base.collection('financialExecutions').doc(executionId).create(root);
  await base
    .collection('financialProofEntries')
    .doc(entry.id)
    .create({ ...entry, siblings: [] });
  await orderDocs(f, 'orderReturnLines')
    .doc(guard.id)
    .set({
      ...guardAfter,
      pendingExecutionId: executionId,
      pendingProofEntryId: entry.id,
      pendingFence: 1,
    });
  const pending = await request(f.app)
    .get(`/api/v1/returns/${before.id}`)
    .set(orderHeaders(f))
    .expect(200);
  expect(pending.body.data.lines[0].financialResolved).toBe('0');
  // A local compatibility fixture, not evidence that the executor publishes correctly.
  await f.firebase.db.runTransaction(async (tx) => {
    tx.create(base.collection('financialProofManifests').doc(executionId), manifest);
    tx.create(orderDocs(f, 'financialEvents').doc(eventId), event);
    tx.create(orderDocs(f, 'returnEvents').doc(returnEventId), returnEvent);
    tx.create(base.collection('returnResolutionStates').doc(before.id), header);
    tx.set(orderDocs(f, 'financialTitles').doc(title.id), nextTitle);
    tx.set(
      orderDocs(f, 'financialOrderStates').doc(order.id),
      s.financialStateSchema.parse({
        ...state,
        canceledCents: 100,
        version: state.version + 1,
        eventSequence: event.sequence,
        headHash: event.hash,
        headEventId: eventId,
        journalVersion: 2,
      }),
    );
    tx.set(orderDocs(f, 'orderFinancialGuards').doc(order.id), {
      ...financialGuard,
      version: financialGuard.version + 1,
      paymentCount: financialGuard.paymentCount + 1,
    });
    tx.set(base.collection('financialExecutions').doc(executionId), {
      ...root,
      status: 'COMPLETED',
      publication: { eventId, eventHash: event.hash, manifestHash: manifest.hash },
    });
  });
  return { order, before, entry, base, productId };
}

describe('F02: devolução v2 e escritores posteriores', () => {
  it('materializa linha publicada e aceita próximo recebimento físico sem repetir estoque', async () => {
    const setup = await publishedPartialReturn();
    const current = (
      await request(f.app)
        .get(`/api/v1/returns/${setup.before.id}`)
        .set(orderHeaders(f))
        .expect(200)
    ).body.data;
    expect(current.lines[0]).toMatchObject({
      financialResolved: '1',
      valueResolvedCents: 100,
      pending: '1',
    });
    expect((await balance(f, setup.productId).expect(200)).body.data.physical).toBe('1');
    const history = await request(f.app)
      .get(`/api/v1/returns/${setup.before.id}/history`)
      .set(orderHeaders(f))
      .expect(200);
    const events = history.body.data.items.map((value: unknown) =>
      r.returnEventView.parse(value),
    ) as ReturnType<typeof r.returnEventView.parse>[];
    expect(events).toHaveLength(setup.before.eventSequence + 1);
    expect(events.map((event) => event.sequence).sort((a, b) => a - b)).toEqual(
      Array.from({ length: setup.before.eventSequence + 1 }, (_, i) => i + 1),
    );
    expect(events.find((event) => event.id === digest('local-final-return-event'))).toMatchObject({
      schemaVersion: 2,
      type: 'resolved',
      sequence: setup.before.eventSequence + 1,
    });
    await request(f.app)
      .get(`/api/v1/returns/${setup.before.id}/resolution-preview`)
      .set(orderHeaders(f))
      .expect(200);
    await financePost(f, `/returns/${setup.before.id}/receipts`, {
      ...(await versions(f, setup.order)),
      expectedVersion: current.version,
      reason: 'Segundo recebimento físico',
      lines: [{ lineId: setup.order.lines[0]!.id, damagedQuantity: '1' }],
    }).expect(200);
    expect((await balance(f, setup.productId).expect(200)).body.data.physical).toBe('1');
    const after = (
      await request(f.app)
        .get(`/api/v1/returns/${setup.before.id}`)
        .set(orderHeaders(f))
        .expect(200)
    ).body.data;
    expect(after.lines[0]).toMatchObject({
      financialResolved: '1',
      damagedReceived: '1',
      pending: '0',
    });
    expect((await orderDocs(f, 'returnReceipts').get()).size).toBe(2);
  });
  it('prova financeira de linha ausente não vira quantidade zero', async () => {
    const setup = await publishedPartialReturn();
    await setup.base.collection('financialProofEntries').doc(setup.entry.id).delete();
    const response = await request(f.app)
      .get(`/api/v1/returns/${setup.before.id}`)
      .set(orderHeaders(f))
      .expect(409);
    expect(response.body.error.code).toBe('FINANCIAL_INTEGRITY');
    expect((await balance(f, setup.productId).expect(200)).body.data.physical).toBe('1');
  });
});
