import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { registerFixture } from '../helpers/fixture.js';
import { financialOrder, receiptBody, financePost, titles } from '../helpers/finance.js';
import { orderDocs, orderHeaders } from '../helpers/orders.js';
import {
  eventSchema,
  paymentSchema,
  financialStateSchema,
  financialResult,
} from '../../src/shared/schemas/finance.js';
import {
  generationSchema,
  activeSourceSchema,
} from '../../src/modules/finance/resolution/sourceIndex.js';
import {
  financialEventHash,
  initialFinancialHash,
} from '../../src/modules/finance/financialBook.js';
import { digest, stableJson } from '../../src/shared/utils/crypto.js';

const f = registerFixture({ rateLimitMax: 10_000 });

describe('F02: recebimentos reais pela API em volumes locais', () => {
  it.each([10, 100, 500])(
    '%i recebimentos mínimos conservam diário, índice, saldos e replay',
    async (count) => {
      const setup = await financialOrder(f);
      expect(setup.order.totalCents).toBeGreaterThanOrEqual(count);
      const initial = await receiptBody(f, setup.order, setup.method, 1);
      expect(initial.allocations).toHaveLength(1);
      let guardVersion = initial.expectedGuardVersion;
      let titleVersion = initial.allocations[0]!.expectedVersion;
      let replay:
        { body: typeof initial; key: ReturnType<typeof randomUUID>; result: unknown } | undefined;
      const started = performance.now();

      // Track versions only after successful HTTP responses; avoid two GETs per receipt.
      for (let index = 0; index < count; index++) {
        const body = {
          ...initial,
          expectedGuardVersion: guardVersion,
          allocations: [{ ...initial.allocations[0]!, expectedVersion: titleVersion }],
        };
        const key = randomUUID();
        const response = await financePost(
          f,
          `/orders/${setup.order.id}/receipts`,
          body,
          key,
        ).expect(200);
        const result = financialResult.parse(response.body.data);
        expect(result).toMatchObject({
          orderId: setup.order.id,
          orderVersion: setup.order.version,
          guardVersion: guardVersion + 1,
          amountCents: 1,
        });
        guardVersion = result.guardVersion;
        titleVersion++;
        replay = { body, key, result: response.body.data };
      }
      expect(replay).toBeDefined();
      const repeated = await financePost(
        f,
        `/orders/${setup.order.id}/receipts`,
        replay!.body,
        replay!.key,
      ).expect(200);
      expect(repeated.body.data).toEqual(replay!.result);

      const rows = await titles(f, setup.order);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        cashCents: count,
        creditCents: 0,
        outstandingCents: setup.order.totalCents - count,
        version: titleVersion,
      });
      const state = financialStateSchema.parse(
        (await orderDocs(f, 'financialOrderStates').doc(setup.order.id).get()).data(),
      );
      expect(state).toMatchObject({
        cashReceivedCents: count,
        cashSettledCents: count,
        transferredCashCents: 0,
        eventSequence: count,
      });
      const apiState = await request(f.app)
        .get(`/api/v1/orders/${setup.order.id}/financial-state`)
        .set(orderHeaders(f))
        .expect(200);
      expect(apiState.body.data).toMatchObject({
        cashReceivedCents: count,
        cashSettledCents: count,
        guardVersion,
      });

      const payments = (await orderDocs(f, 'payments').get()).docs.map((doc) =>
        paymentSchema.parse(doc.data()),
      );
      const byId = new Map(payments.map((payment) => [payment.id, payment]));
      expect(payments).toHaveLength(count);
      expect(payments.reduce((sum, payment) => sum + payment.amountCents, 0)).toBe(count);
      const events = (await orderDocs(f, 'financialEvents').orderBy('sequence').get()).docs.map(
        (doc) => eventSchema.parse(doc.data()),
      );
      expect(events).toHaveLength(count);
      let previous = initialFinancialHash(f.tenantA.tenant.id, setup.order.id);
      for (const [position, event] of events.entries()) {
        expect(event.sequence).toBe(position + 1);
        expect(event.previousHash).toBe(previous);
        expect(event.hash).toBe(financialEventHash(event));
        expect(event.before.cashSettledCents).toBe(position);
        expect(event.after.cashSettledCents).toBe(position + 1);
        expect(event.references).toEqual([event.operationId]);
        expect(byId.has(event.operationId)).toBe(true);
        previous = event.hash;
      }
      expect(previous).toBe(state.headHash);
      const generations = await orderDocs(f, 'financialSourceGenerations')
        .where('kind', '==', 'active')
        .get();
      expect(generations.size).toBe(1);
      const generation = generationSchema.parse(generations.docs[0]!.data());
      expect(generation).toMatchObject({
        certified: true,
        rowCount: count,
        headHash: state.headHash,
        eventSequence: count,
        stateVersion: state.version,
      });
      const sources = (
        await orderDocs(f, 'financialActiveSources')
          .where('generationId', '==', generation.generationId)
          .get()
      ).docs.map((doc) => activeSourceSchema.parse(doc.data()));
      expect(sources).toHaveLength(count);
      expect(sources.reduce((sum, source) => sum + source.remainingCents, 0)).toBe(count);
      for (const source of sources) {
        const payment = byId.get(source.sourceId);
        expect(payment).toBeDefined();
        expect(source).toMatchObject({
          tenantId: f.tenantA.tenant.id,
          orderId: setup.order.id,
          kind: 'cash',
          remainingCents: 1,
          sourceVersion: 1,
          sourceHash: digest(stableJson(payment)),
          originEventId: digest(`financial-event:${source.sourceId}`),
          proofEventId: digest(`financial-event:${source.sourceId}`),
        });
      }
      expect(
        (await orderDocs(f, 'financialOperations').where('action', '==', 'receipt').get()).size,
      ).toBe(count);

      const excess = await financePost(f, `/orders/${setup.order.id}/receipts`, {
        ...initial,
        expectedGuardVersion: guardVersion,
        amountCents: setup.order.totalCents - count + 1,
        allocations: [
          {
            ...initial.allocations[0]!,
            expectedVersion: titleVersion,
            amountCents: setup.order.totalCents - count + 1,
          },
        ],
      }).expect(409);
      expect(excess.body.error.code).toBe('EXCESS_PAYMENT');
      expect((await orderDocs(f, 'financialOrderStates').doc(setup.order.id).get()).data()).toEqual(
        state,
      );
      expect((await orderDocs(f, 'payments').get()).size).toBe(count);
      console.info(
        JSON.stringify({
          scenario: 'F02-local-real-receipts',
          receiptHttpCalls: count,
          replayHttpCalls: 1,
          rejectedExcessHttpCalls: 1,
          elapsedMs: Math.round(performance.now() - started),
          seededSources: 0,
          environment: 'demo-lastro-tests emulator',
        }),
      );
    },
    600_000,
  );
});
