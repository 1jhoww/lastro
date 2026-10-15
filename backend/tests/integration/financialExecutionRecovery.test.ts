import request, { type Response } from 'supertest';
import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { registerFixture, tenantHeaders } from '../helpers/fixture.js';
import { financialOrder, financePost, versions, receiptBody } from '../helpers/finance.js';
import { orderDocs, orderHeaders } from '../helpers/orders.js';
import { seedValidFinancialSources } from '../helpers/financialSourceSeed.js';
import {
  advanceExecution,
  finishExecution,
  currentExecution,
  type Execution,
} from '../helpers/financialExecution.js';
import { seller } from '../helpers/commercial.js';
const f = registerFixture({ rateLimitMax: 10_000 });
describe('F02: fencing, recuperação, provas e autorização', () => {
  async function start(count = 80) {
    const setup = await financialOrder(f);
    await seedValidFinancialSources(f, setup, count);
    const body = {
      ...(await versions(f, setup.order)),
      disposition: 'customer_credit',
      reason: 'Recuperação sintética F02',
    };
    const e = (
      await financePost(
        f,
        `/orders/${setup.order.id}/financial-cancellation-executions`,
        body,
      ).expect(202)
    ).body.data as Execution;
    return { setup, e };
  }
  it('idempotência de origem adulterada impede aplicar mesmo com totais do índice corretos', async () => {
    const { setup, e: accepted } = await start(10);
    const operation = (
      await orderDocs(f, 'financialOperations')
        .where('action', '==', 'receipt')
        .where('resourceId', '==', setup.order.id)
        .limit(1)
        .get()
    ).docs[0]!;
    await operation.ref.update({ 'result.amountCents': 99 });
    let e = accepted,
      attempts = 0;
    while (e.status !== 'NEEDS_REVIEW' && e.status !== 'PAUSED') {
      expect(attempts++).toBeLessThan(20);
      e = await advanceExecution(f, e);
    }
    expect(e.progress.applied).toBe(0);
    expect(
      (await orderDocs(f, 'financialOrderStates').doc(setup.order.id).get()).get(
        'cashSettledCents',
      ),
    ).toBe(10);
    expect((await orderDocs(f, 'creditLots').get()).size).toBe(0);
  }, 120_000);
  it('concorrência publica um passo; lease antigo não aplica; expiração não libera bloqueio', async () => {
    const started = await start();
    const setup = started.setup;
    let e = started.e;
    const input = { expectedRevision: e.revision, fencingToken: e.fencingToken },
      key = randomUUID();
    const concurrent = await Promise.all([
      financePost(f, `/financial-executions/${e.id}/advance`, input, key),
      financePost(f, `/financial-executions/${e.id}/advance`, input, key),
    ]);
    expect(concurrent.map((r) => r.status).every((s) => [202, 409].includes(s))).toBe(true);
    e = await currentExecution(f, e.id);
    await orderDocs(f, 'financialExecutions')
      .doc(e.id)
      .update({ leaseUntil: new Date(Date.now() - 1000).toISOString() });
    const blocked = await financePost(
      f,
      `/orders/${setup.order.id}/receipts`,
      await receiptBody(f, setup.order, setup.method, 1),
    ).expect(409);
    expect(blocked.body.error.code).toBe('FINANCIAL_OPERATION_IN_PROGRESS');
    const old = e;
    e = (
      await financePost(f, `/financial-executions/${e.id}/resume`, {
        expectedRevision: e.revision,
        reason: 'Retomar lease expirado',
      }).expect(202)
    ).body.data;
    expect(e.fencingToken).toBe(old.fencingToken + 1);
    await financePost(f, `/financial-executions/${e.id}/advance`, {
      expectedRevision: e.revision,
      fencingToken: old.fencingToken,
    }).expect(409);
    await finishExecution(f, e);
    expect(
      (await orderDocs(f, 'financialEvents').where('type', '==', 'financial_cancellation').get())
        .size,
    ).toBe(1);
  }, 120_000);
  it('prova ausente após aplicação exige revisão, restaura corpo selado e conclui sem dinheiro duplicado', async () => {
    let { e } = await start(180);
    let guard = 0;
    while (e.progress.applied === 0) {
      expect(guard++).toBeLessThan(100);
      expect(['PAUSED', 'NEEDS_REVIEW']).not.toContain(e.status);
      e = await advanceExecution(f, e);
    }
    expect(e.progress.applied).toBeLessThan(180);
    await financePost(f, `/financial-executions/${e.id}/abort`, {
      expectedRevision: e.revision,
      reason: 'Abort indevido após efeito',
    }).expect(409);
    const chunk = (
      await orderDocs(f, 'financialProofChunks')
        .where('executionId', '==', e.id)
        .where('position', '==', e.progress.applied)
        .get()
    ).docs[0]!;
    const entry = chunk.get('entry');
    await orderDocs(f, 'financialProofEntries').doc(entry.id).delete();
    e = await advanceExecution(f, e);
    expect(e.status).toBe('NEEDS_REVIEW');
    const state = (await orderDocs(f, 'financialOrderStates').doc(e.orderId).get()).data();
    expect(state?.transferredCashCents).toBe(0);
    e = (
      await financePost(f, `/financial-executions/${e.id}/resume`, {
        expectedRevision: e.revision,
        reason: 'Restaurar prova selada ausente',
      }).expect(202)
    ).body.data;
    await finishExecution(f, e);
    expect((await orderDocs(f, 'financialProofEntries').doc(entry.id).get()).data()).toEqual(entry);
    expect((await orderDocs(f, 'creditLots').get()).docs.map((d) => d.get('issuedCents'))).toEqual([
      180,
    ]);
  }, 180_000);
  it('reconciliação paginada mantém falha anterior e identifica lacuna', async () => {
    const { e: accepted } = await start(80),
      e = await finishExecution(f, accepted);
    const chunks = await orderDocs(f, 'financialProofChunks')
      .where('executionId', '==', e.id)
      .orderBy('position')
      .get();
    await orderDocs(f, 'financialProofEntries').doc(chunks.docs[0]!.get('entryId')).delete();
    let cursor: string | null = null,
      checked: number;
    do {
      const response: Response = await request(f.app)
        .get(`/api/v1/financial-executions/${e.id}/proof-reconciliation`)
        .query({ limit: '10', ...(cursor ? { cursor } : {}) })
        .set(orderHeaders(f))
        .expect(200);
      expect(response.body.data.consistent).toBe(false);
      checked = response.body.data.checkedEntries;
      cursor = response.body.data.nextCursor;
    } while (cursor);
    expect(checked).toBe(80);
  }, 120_000);
  it('abort antes da aplicação mantém saldos; vendedor e outra empresa não consultam execução', async () => {
    const { e } = await start(10),
      sales = await seller(f);
    await request(f.app)
      .get(`/api/v1/financial-executions/${e.id}`)
      .set(orderHeaders(f, sales))
      .expect(403);
    await request(f.app)
      .get(`/api/v1/financial-executions/${e.id}`)
      .set(tenantHeaders(f.ownerB, f.tenantB.tenant.id))
      .expect(404);
    await financePost(f, `/financial-executions/${e.id}/abort`, {
      expectedRevision: e.revision,
      reason: 'Abort permitido antes de efeito',
    }).expect(200);
    expect(
      (await orderDocs(f, 'financialOrderStates').doc(e.orderId).get()).get('cashSettledCents'),
    ).toBe(10);
  }, 120_000);
  it('prova adulterada não recebe overwrite nem publicação artificial após retomada', async () => {
    let { e } = await start(180);
    let guard = 0;
    while (e.progress.applied === 0) {
      expect(guard++).toBeLessThan(100);
      e = await advanceExecution(f, e);
    }
    const chunk = (
      await orderDocs(f, 'financialProofChunks')
        .where('executionId', '==', e.id)
        .where('position', '==', e.progress.applied)
        .get()
    ).docs[0]!;
    const ref = orderDocs(f, 'financialProofEntries').doc(chunk.get('entryId'));
    await ref.update({ hash: '0'.repeat(64) });
    e = await advanceExecution(f, e);
    expect(e.status).toBe('NEEDS_REVIEW');
    e = (
      await financePost(f, `/financial-executions/${e.id}/resume`, {
        expectedRevision: e.revision,
        reason: 'Revisar corpo adulterado sem saldo inferido',
      }).expect(202)
    ).body.data;
    e = await advanceExecution(f, e);
    expect(e.status).toBe('NEEDS_REVIEW');
    expect((await ref.get()).get('hash')).toBe('0'.repeat(64));
    expect((await orderDocs(f, 'creditLots').get()).size).toBe(0);
    expect(
      (await orderDocs(f, 'financialOrderStates').doc(e.orderId).get()).get('cashSettledCents'),
    ).toBe(180);
    await financePost(f, `/financial-executions/${e.id}/abort`, {
      expectedRevision: e.revision,
      reason: 'Abort continua proibido',
    }).expect(409);
  }, 180_000);
  it('revogação para executor; administrador atual assume intenção com novo fence', async () => {
    const replacement = await seller(f),
      original = f.ownerA;
    const member = f.firebase.db.doc(
      `tenants/${f.tenantA.tenant.id}/memberships/${replacement.uid}`,
    );
    await member.update({
      role: 'administrator',
      version: (await member.get()).get('version') + 1,
    });
    const { e: accepted } = await start(10);
    await f.firebase.db
      .doc(`tenants/${f.tenantA.tenant.id}/memberships/${original.uid}`)
      .update({ status: 'disabled' });
    await financePost(f, `/financial-executions/${accepted.id}/advance`, {
      expectedRevision: accepted.revision,
      fencingToken: accepted.fencingToken,
    }).expect(403);
    await orderDocs(f, 'financialExecutions')
      .doc(accepted.id)
      .update({ leaseUntil: new Date(Date.now() - 1000).toISOString() });
    f.ownerA = replacement;
    const resumed = (
      await financePost(f, `/financial-executions/${accepted.id}/resume`, {
        expectedRevision: accepted.revision,
        reason: 'Administrador autorizado assume intenção',
      }).expect(202)
    ).body.data as Execution;
    expect(resumed.fencingToken).toBe(accepted.fencingToken + 1);
    await finishExecution(f, resumed);
    const root = (await orderDocs(f, 'financialExecutions').doc(accepted.id).get()).data();
    expect(root).toMatchObject({
      createdBy: original.uid,
      authorizedBy: replacement.uid,
      status: 'COMPLETED',
    });
  }, 120_000);
});
