import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { registerFixture } from '../helpers/fixture.js';
import { financialOrder, financePost, versions, titles } from '../helpers/finance.js';
import { stockProduct, enter, balance } from '../helpers/inventory.js';
import { orderDocs, orderHeaders, command } from '../helpers/orders.js';
import { seedValidFinancialSources } from '../helpers/financialSourceSeed.js';
import {
  advanceExecution,
  finishExecution,
  refreshFinancialActor,
  type Execution,
} from '../helpers/financialExecution.js';
import { orderView } from '../../src/shared/schemas/orders.js';
import { planId, planSchema } from '../../src/modules/finance/resolution/executionModel.js';
import { proofChunkSchema } from '../../src/modules/finance/resolution/proofStorage.js';
import {
  sourceProofSchema,
  sourceProofHash,
} from '../../src/modules/finance/resolution/proofRecords.js';
import { verifyProofMembership } from '../../src/modules/finance/resolution/proofs.js';
import { activeGenerationId } from '../../src/modules/finance/resolution/sourceIndex.js';
import { stableJson } from '../../src/shared/utils/crypto.js';
import { financialCapacityReport } from '../helpers/financialCapacityReport.js';
const f = registerFixture({ rateLimitMax: 100_000 });
describe('F02: 20 mil fontes válidas diretas, não recebimentos HTTP', () => {
  for (const kind of ['cancellation', 'return'] as const)
    it(`${kind}: 20.000 centavos, publicação única, retomada e prova fragmentada`, async () => {
      const started = performance.now(),
        productId = await stockProduct(f, { priceCents: 20_000 });
      await enter(f, productId, '1').expect(201);
      const setup = await financialOrder(f, { lines: [{ productId, quantity: '1' }] });
      const seed = await seedValidFinancialSources(f, setup, 20_000);
      expect(seed.receiptHttpCalls).toBe(0);
      await refreshFinancialActor(f);
      let order = setup.order,
        e: Execution,
        returnId: string | null = null;
      if (kind === 'cancellation') {
        const old = await financePost(f, `/orders/${order.id}/financial-cancellation`, {
          ...(await versions(f, order)),
          disposition: 'customer_credit',
          reason: 'Histórico grande exige execução',
        }).expect(409);
        expect(old.body.error.code).toBe('FINANCIAL_RESUMABLE_REQUIRED');
        e = (
          await financePost(f, `/orders/${order.id}/financial-cancellation-executions`, {
            ...(await versions(f, order)),
            disposition: 'customer_credit',
            reason: '20 mil fontes sintéticas válidas',
          }).expect(202)
        ).body.data;
      } else {
        order = orderView.parse((await command(f, order, 'dispatch').expect(200)).body.data);
        const value = (
          await financePost(f, `/orders/${order.id}/returns`, {
            ...(await versions(f, order)),
            lines: [{ lineId: order.lines[0]!.id, quantity: '1' }],
            reason: 'Retorno físico integral',
          }).expect(201)
        ).body.data;
        returnId = value.returnId;
        await financePost(f, `/returns/${returnId}/receipts`, {
          ...(await versions(f, order)),
          expectedVersion: value.returnVersion,
          lines: [{ lineId: order.lines[0]!.id, sellableQuantity: '1' }],
          reason: 'Unidade recebida fisicamente',
        }).expect(200);
        const valueAfter = (
          await request(f.app).get(`/api/v1/returns/${returnId}`).set(orderHeaders(f)).expect(200)
        ).body.data;
        e = (
          await financePost(f, `/returns/${returnId}/resolution-executions`, {
            ...(await versions(f, order)),
            expectedVersion: valueAfter.version,
            disposition: 'customer_credit',
            reason: '20 mil fontes após recebimento',
          }).expect(202)
        ).body.data;
      }
      let recovered: boolean,
        steps = 0;
      while (e.progress.applied === 0) {
        e = await advanceExecution(f, e);
        expect(['NEEDS_REVIEW', 'PAUSED']).not.toContain(e.status);
      }
      expect(e.progress.applied).toBeLessThan(20_000);
      const stateBefore = (await orderDocs(f, 'financialOrderStates').doc(order.id).get()).data();
      expect(stateBefore).toMatchObject({ cashSettledCents: 20_000, transferredCashCents: 0 });
      if (kind === 'cancellation') {
        const chunk = (
          await orderDocs(f, 'financialProofChunks')
            .where('executionId', '==', e.id)
            .where('position', '==', e.progress.applied)
            .get()
        ).docs[0]!;
        await orderDocs(f, 'financialProofEntries').doc(chunk.get('entryId')).delete();
        e = await advanceExecution(f, e);
        expect(e.status).toBe('NEEDS_REVIEW');
        await refreshFinancialActor(f);
        e = (
          await financePost(f, `/financial-executions/${e.id}/resume`, {
            expectedRevision: e.revision,
            reason: 'Recuperar fragmento selado ausente',
          }).expect(202)
        ).body.data;
        recovered = true;
      } else {
        await orderDocs(f, 'financialExecutions')
          .doc(e.id)
          .update({ leaseUntil: new Date(Date.now() - 1000).toISOString() });
        await refreshFinancialActor(f);
        e = (
          await financePost(f, `/financial-executions/${e.id}/resume`, {
            expectedRevision: e.revision,
            reason: 'Retomar após interrupção local',
          }).expect(202)
        ).body.data;
        recovered = true;
      }
      e = await finishExecution(f, e, async (current) => {
        if (++steps % 100 === 0) {
          console.info(
            JSON.stringify({
              capacity: kind,
              status: current.status,
              phase: current.phase,
              applied: current.progress.applied,
              revision: current.revision,
            }),
          );
          const state = (await orderDocs(f, 'financialOrderStates').doc(order.id).get()).data();
          expect(state?.transferredCashCents).toBe(current.financialCompleted ? 20_000 : 0);
        }
      });
      expect(recovered).toBe(true);
      expect(e.result?.amountCents).toBe(20_000);
      const rows = await titles(f, order);
      expect(rows[0]).toMatchObject({
        outstandingCents: 0,
        cashCents: 0,
        creditCents: 0,
        canceledCents: 20_000,
      });
      const state = (await orderDocs(f, 'financialOrderStates').doc(order.id).get()).data();
      expect(state).toMatchObject({
        cashReceivedCents: 20_000,
        cashSettledCents: 0,
        transferredCashCents: 20_000,
      });
      const events = await orderDocs(f, 'financialEvents')
        .where('type', '==', kind === 'cancellation' ? 'financial_cancellation' : 'return_resolved')
        .get();
      expect(events.size).toBe(1);
      expect(Buffer.byteLength(JSON.stringify(events.docs[0]!.data()))).toBeLessThan(256 * 1024);
      expect(events.docs[0]!.get('references').length).toBeLessThanOrEqual(4);
      expect(
        (await orderDocs(f, 'creditLots').get()).docs.map((d) => d.get('issuedCents')),
      ).toEqual([20_000]);
      expect((await balance(f, productId).expect(200)).body.data).toMatchObject({
        physical: '1',
        reserved: '0',
      });
      if (returnId) {
        expect(
          (await orderDocs(f, 'returnReceipts').where('returnId', '==', returnId).get()).size,
        ).toBe(1);
        expect(
          (await request(f.app).get(`/api/v1/returns/${returnId}`).set(orderHeaders(f)).expect(200))
            .body.data.status,
        ).toBe('closed');
      }
      const meta = planSchema.parse(
        (await orderDocs(f, 'financialExecutionPlans').doc(planId(e.id)).get()).data(),
      );
      const published = events.docs[0]!.get('proof');
      const expectedProofs = kind === 'return' ? 20_001 : 20_000;
      expect(published.entryCount).toBe(expectedProofs);
      let checked = 0,
        sourceCount = 0,
        transferred = 0;
      for (;;) {
        const chunks = await orderDocs(f, 'financialProofChunks')
          .where('executionId', '==', e.id)
          .orderBy('position')
          .startAt(checked)
          .limit(250)
          .get();
        if (chunks.empty) break;
        const originals = await orderDocs(f, 'financialProofEntries')
          .where('executionId', '==', e.id)
          .orderBy('position')
          .startAt(checked)
          .limit(250)
          .get();
        expect(originals.size).toBe(chunks.size);
        for (const [index, doc] of chunks.docs.entries()) {
          const chunk = proofChunkSchema.parse(doc.data()),
            original = sourceProofSchema.parse(originals.docs[index]!.data());
          expect(chunk.position).toBe(checked++);
          expect(stableJson(original)).toBe(stableJson(chunk.entry));
          expect(chunk.entry.hash).toBe(sourceProofHash(chunk.entry));
          expect(
            verifyProofMembership(
              { tenantId: f.tenantA.tenant.id, executionId: e.id, entryCount: expectedProofs },
              published.rootHash,
              chunk.position,
              chunk.entryHash,
              chunk.siblings!,
            ),
          ).toBe(true);
        }
      }
      expect(checked).toBe(expectedProofs);
      let last: string | null = null;
      for (;;) {
        let query = orderDocs(f, 'payments').where('orderId', '==', order.id).orderBy('__name__');
        if (last) query = query.startAfter(last);
        const page = await query.limit(250).get();
        if (page.empty) break;
        for (const doc of page.docs) {
          expect(doc.get('transferredCents')).toBe(1);
          expect(doc.get('reversedCents')).toBe(0);
          expect(doc.get('allocations')[0].remainingCents).toBe(0);
          expect(doc.get('pendingExecutionId')).toBe(e.id);
          sourceCount++;
          transferred += doc.get('transferredCents');
          last = doc.id;
        }
      }
      expect(sourceCount).toBe(20_000);
      expect(transferred).toBe(20_000);
      const generation = (
        await orderDocs(f, 'financialSourceGenerations')
          .doc(activeGenerationId(f.tenantA.tenant.id, order.id))
          .get()
      ).data();
      expect(generation).toMatchObject({
        certified: true,
        rowCount: 0,
        stateVersion: state!.version,
        headHash: state!.headHash,
      });
      expect(
        (
          await orderDocs(f, 'financialActiveSources')
            .where('generationId', '==', generation!.generationId)
            .limit(1)
            .get()
        ).empty,
      ).toBe(true);
      expect(meta.metrics.maxReads).toBeLessThanOrEqual(150);
      expect(meta.metrics.maxWrites).toBeLessThanOrEqual(100);
      expect(meta.metrics.maxEstimatedBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
      expect(meta.metrics.maxDocumentBytes).toBeLessThanOrEqual(256 * 1024);
      const record = {
        f02Capacity: kind,
        sources: 20_000,
        receiptHttpCalls: 0,
        seed,
        execution: meta.metrics,
        elapsedMs: Math.round(performance.now() - started),
        proofs: e.progress,
        publicationCount: events.size,
        completedAt: new Date().toISOString(),
        environment: 'demo-lastro-tests emulator',
        independentlyCheckedProofs: checked,
        independentlyCheckedPayments: sourceCount,
      };
      await financialCapacityReport(record);
      console.info(JSON.stringify(record));
    }, 3_600_000);
});
