import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { registerFixture } from '../helpers/fixture.js';
import {
  financialOrder,
  receiptBody,
  financePost,
  creditSource,
  titles,
  versions,
} from '../helpers/finance.js';
import { orderDocs } from '../helpers/orders.js';
import { FoundationRepository } from '../../src/infrastructure/repositories/foundationRepository.js';
import { CommercialRepository } from '../../src/infrastructure/repositories/commercialRepository.js';
import { AccessService } from '../../src/modules/auth/accessService.js';
import { FinancialCommands } from '../../src/modules/finance/financialCommands.js';
import { SourceBackfill } from '../../src/modules/finance/resolution/sourceBackfill.js';
import { activeGenerationId } from '../../src/modules/finance/resolution/sourceIndex.js';
import type { Actor } from '../../src/shared/types/context.js';

const f = registerFixture();
function service() {
  const foundation = new FoundationRepository(f.firebase.db);
  return new SourceBackfill(
    new FinancialCommands(
      new CommercialRepository(foundation, f.config.invitationSecret),
      new AccessService(foundation),
      () => new Date(Date.now() + f.offset),
    ),
  );
}
function actor(uid = f.ownerA.uid): Actor {
  return {
    uid,
    email: null,
    emailVerified: true,
    authTime: Math.floor(Date.now() / 1000),
    requestId: randomUUID(),
  };
}
async function legacy(count = 10) {
  const setup = await financialOrder(f);
  const body = await receiptBody(f, setup.order, setup.method, 1);
  for (let index = 0; index < count; index++) {
    const response = await financePost(f, `/orders/${setup.order.id}/receipts`, {
      ...body,
      expectedGuardVersion: body.expectedGuardVersion + index,
      allocations: [
        { ...body.allocations[0]!, expectedVersion: body.allocations[0]!.expectedVersion + index },
      ],
    }).expect(200);
    expect(response.body.data.amountCents).toBe(1);
  }
  // Remove only the local fixture's active pointer to model a pre-index order.
  await orderDocs(f, 'financialSourceGenerations')
    .doc(activeGenerationId(f.tenantA.tenant.id, setup.order.id))
    .delete();
  return { ...setup, body };
}

describe('F02: backfill certificado sem mutação financeira', () => {
  it('retoma páginas, conserva replay e publica somente após validar todas as fontes', async () => {
    const setup = await legacy(30);
    const before = await orderDocs(f, 'financialOrderStates').doc(setup.order.id).get();
    const paymentBefore = await orderDocs(f, 'payments').get();
    const startKey = randomUUID();
    let build = await service().start(actor(), f.tenantA.tenant.id, setup.order.id, startKey);
    expect(build.phase).toBe('journal');
    const first = build;
    const pointer = orderDocs(f, 'financialSourceGenerations').doc(
      activeGenerationId(f.tenantA.tenant.id, setup.order.id),
    );
    expect((await pointer.get()).exists).toBe(false);
    let steps = 0;
    while (build.phase !== 'complete') {
      expect(steps++).toBeLessThan(30);
      const key = randomUUID();
      const revision = build.revision;
      const next = await service().advance(actor(), f.tenantA.tenant.id, build.id, key, revision);
      expect(
        await service().advance(actor(), f.tenantA.tenant.id, build.id, key, revision),
      ).toEqual(next);
      build = next;
      if (build.phase !== 'complete') expect((await pointer.get()).exists).toBe(false);
    }
    expect(build).toMatchObject({
      journalCount: 30,
      examined: 30,
      rowCount: 30,
      validatedRows: 30,
    });
    expect((await pointer.get()).data()).toMatchObject({
      certified: true,
      rowCount: 30,
      generationId: build.generationId,
    });
    expect(await service().start(actor(), f.tenantA.tenant.id, setup.order.id, startKey)).toEqual(
      first,
    );
    expect((await orderDocs(f, 'financialOrderStates').doc(setup.order.id).get()).data()).toEqual(
      before.data(),
    );
    const paymentAfter = await orderDocs(f, 'payments').get();
    expect(paymentAfter.docs.map((d) => d.data())).toEqual(paymentBefore.docs.map((d) => d.data()));
    expect((await orderDocs(f, 'financialEvents').get()).size).toBe(30);
    const canceled = (
      await financePost(f, `/orders/${setup.order.id}/financial-cancellation`, {
        ...(await versions(f, setup.order)),
        disposition: 'customer_credit',
        reason: 'Cancelamento após backfill certificado',
      }).expect(200)
    ).body.data;
    expect((await orderDocs(f, 'creditLots').doc(canceled.creditLotId).get()).data()).toMatchObject(
      { issuedCents: 30, availableCents: 30, appliedCents: 0 },
    );
    expect(
      (await orderDocs(f, 'financialOrderStates').doc(setup.order.id).get()).data(),
    ).toMatchObject({ cashReceivedCents: 30, cashSettledCents: 0, transferredCashCents: 30 });
    expect((await pointer.get()).data()).toMatchObject({ certified: true, rowCount: 0 });
  });
  it('evento ausente impede certificação sem avançar checkpoint nem alterar saldo', async () => {
    const setup = await legacy();
    const build = await service().start(actor(), f.tenantA.tenant.id, setup.order.id, randomUUID());
    const event = (await orderDocs(f, 'financialEvents').orderBy('sequence').limit(1).get())
      .docs[0]!;
    await event.ref.delete();
    await expect(
      service().advance(actor(), f.tenantA.tenant.id, build.id, randomUUID(), build.revision),
    ).rejects.toMatchObject({ status: 409, code: 'FINANCIAL_INTEGRITY' });
    expect((await orderDocs(f, 'financialSourceGenerations').doc(build.id).get()).data()).toEqual(
      build,
    );
    expect(
      (
        await orderDocs(f, 'financialSourceGenerations')
          .doc(activeGenerationId(f.tenantA.tenant.id, setup.order.id))
          .get()
      ).exists,
    ).toBe(false);
    expect(
      (await orderDocs(f, 'financialOrderStates').doc(setup.order.id).get()).get(
        'cashSettledCents',
      ),
    ).toBe(10);
  });
  it('linha ausente na geração em construção impede publicação do certificado', async () => {
    const setup = await legacy();
    let build = await service().start(actor(), f.tenantA.tenant.id, setup.order.id, randomUUID());
    while (build.phase !== 'credit') {
      build = await service().advance(
        actor(),
        f.tenantA.tenant.id,
        build.id,
        randomUUID(),
        build.revision,
      );
    }
    const row = (
      await orderDocs(f, 'financialActiveSources')
        .where('generationId', '==', build.generationId)
        .limit(1)
        .get()
    ).docs[0]!;
    await row.ref.delete();
    let rejected = false;
    for (let step = 0; step < 10; step++) {
      try {
        build = await service().advance(
          actor(),
          f.tenantA.tenant.id,
          build.id,
          randomUUID(),
          build.revision,
        );
      } catch (error) {
        expect(error).toMatchObject({ status: 409, code: 'FINANCIAL_INTEGRITY' });
        rejected = true;
        break;
      }
      expect(build.phase).not.toBe('complete');
    }
    expect(rejected).toBe(true);
    expect(
      (
        await orderDocs(f, 'financialSourceGenerations')
          .doc(activeGenerationId(f.tenantA.tenant.id, setup.order.id))
          .get()
      ).exists,
    ).toBe(false);
    expect(
      (await orderDocs(f, 'financialOrderStates').doc(setup.order.id).get()).get(
        'cashSettledCents',
      ),
    ).toBe(10);
  });
  it('escrita financeira concorrente exige nova geração; nenhuma soma antiga é publicada', async () => {
    const setup = await legacy();
    const build = await service().start(actor(), f.tenantA.tenant.id, setup.order.id, randomUUID());
    await financePost(
      f,
      `/orders/${setup.order.id}/receipts`,
      await receiptBody(f, setup.order, setup.method, 1),
    ).expect(200);
    await expect(
      service().advance(actor(), f.tenantA.tenant.id, build.id, randomUUID(), build.revision),
    ).rejects.toMatchObject({ status: 409, code: 'FINANCIAL_SOURCE_GENERATION_STALE' });
    expect((await orderDocs(f, 'financialSourceGenerations').doc(build.id).get()).data()).toEqual(
      build,
    );
    expect(
      (
        await orderDocs(f, 'financialSourceGenerations')
          .doc(activeGenerationId(f.tenantA.tenant.id, setup.order.id))
          .get()
      ).get('certified'),
    ).toBe(false);
    expect(
      (await orderDocs(f, 'financialOrderStates').doc(setup.order.id).get()).get(
        'cashSettledCents',
      ),
    ).toBe(11);
  });
  it('revalida autorização e isolamento em cada avanço, inclusive replay', async () => {
    const setup = await legacy();
    const build = await service().start(actor(), f.tenantA.tenant.id, setup.order.id, randomUUID());
    const key = randomUUID();
    await expect(
      service().advance(actor(f.ownerB.uid), f.tenantA.tenant.id, build.id, key, build.revision),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service().advance(actor(), f.tenantB.tenant.id, build.id, key, build.revision),
    ).rejects.toMatchObject({ status: 403 });
    await service().advance(actor(), f.tenantA.tenant.id, build.id, key, build.revision);
    await f.firebase.db
      .doc(`tenants/${f.tenantA.tenant.id}/memberships/${f.ownerA.uid}`)
      .update({ status: 'disabled' });
    await expect(
      service().advance(actor(), f.tenantA.tenant.id, build.id, key, build.revision),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('dois avanços concorrentes publicam um único checkpoint, sem duplicar linhas', async () => {
    const setup = await legacy();
    const build = await service().start(actor(), f.tenantA.tenant.id, setup.order.id, randomUUID());
    const results = await Promise.allSettled([
      service().advance(actor(), f.tenantA.tenant.id, build.id, randomUUID(), build.revision),
      service().advance(actor(), f.tenantA.tenant.id, build.id, randomUUID(), build.revision),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failures = results.filter((r) => r.status === 'rejected');
    expect(failures).toHaveLength(1);
    expect(failures[0]!.reason).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(
      (await orderDocs(f, 'financialSourceGenerations').doc(build.id).get()).get('revision'),
    ).toBe(build.revision + 1);
    expect(
      (await orderDocs(f, 'financialOrderStates').doc(setup.order.id).get()).get(
        'cashSettledCents',
      ),
    ).toBe(10);
  });
  it('certifica crédito multialocado sem alterar lote compartilhado nem histórico', async () => {
    const credit = await creditSource(f, 30);
    const setup = await financialOrder(f, {
      customerId: credit.order.customerId,
      paymentConditionId: null,
      paymentConditionVersion: undefined,
      payment: { type: 'installments', dueDates: ['2090-01-01', '2090-02-01', '2090-03-01'] },
    });
    const rows = await titles(f, setup.order);
    await financePost(f, `/orders/${setup.order.id}/credit-applications`, {
      ...(await versions(f, setup.order)),
      customerId: setup.order.customerId,
      creditLotId: credit.creditLotId,
      expectedLotVersion: 1,
      amountCents: 6,
      allocations: rows.map((row, i) => ({
        receivableId: row.id,
        expectedVersion: row.version,
        amountCents: i + 1,
      })),
      reason: 'Crédito multialocado local',
    }).expect(200);
    await financePost(
      f,
      `/orders/${setup.order.id}/receipts`,
      await receiptBody(f, setup.order, setup.method, 1),
    ).expect(200);
    const lotBefore = (await orderDocs(f, 'creditLots').doc(credit.creditLotId).get()).data();
    const stateBefore = (
      await orderDocs(f, 'financialOrderStates').doc(setup.order.id).get()
    ).data();
    let build = await service().start(actor(), f.tenantA.tenant.id, setup.order.id, randomUUID());
    for (let step = 0; build.phase !== 'complete'; step++) {
      expect(step).toBeLessThan(30);
      build = await service().advance(
        actor(),
        f.tenantA.tenant.id,
        build.id,
        randomUUID(),
        build.revision,
      );
    }
    expect(build).toMatchObject({ journalCount: 2, examined: 2, rowCount: 4, validatedRows: 4 });
    expect(build.totals.reduce((sum, t) => sum + t.cashCents, 0)).toBe(1);
    expect(build.totals.reduce((sum, t) => sum + t.creditCents, 0)).toBe(6);
    expect((await orderDocs(f, 'creditLots').doc(credit.creditLotId).get()).data()).toEqual(
      lotBefore,
    );
    expect((await orderDocs(f, 'financialOrderStates').doc(setup.order.id).get()).data()).toEqual(
      stateBefore,
    );
  });
  it('fonte totalmente estornada ausente não vira certificado válido por soma zero', async () => {
    const setup = await legacy();
    const payment = (await orderDocs(f, 'payments').limit(1).get()).docs[0]!;
    const title = (await titles(f, setup.order))[0]!;
    await financePost(f, `/payments/${payment.id}/reversals`, {
      ...(await versions(f, setup.order)),
      expectedVersion: 1,
      amountCents: 1,
      allocations: [{ receivableId: title.id, expectedVersion: title.version, amountCents: 1 }],
      reason: 'Estorno integral da fonte da fixture',
    }).expect(200);
    await orderDocs(f, 'financialSourceGenerations')
      .doc(activeGenerationId(f.tenantA.tenant.id, setup.order.id))
      .delete();
    await payment.ref.delete();
    let build = await service().start(actor(), f.tenantA.tenant.id, setup.order.id, randomUUID());
    let rejected = false;
    for (let step = 0; step < 30; step++) {
      try {
        build = await service().advance(
          actor(),
          f.tenantA.tenant.id,
          build.id,
          randomUUID(),
          build.revision,
        );
      } catch (error) {
        expect(error).toMatchObject({ status: 409, code: 'FINANCIAL_INTEGRITY' });
        rejected = true;
        break;
      }
      expect(build.phase).not.toBe('complete');
    }
    expect(rejected).toBe(true);
    expect(
      (
        await orderDocs(f, 'financialSourceGenerations')
          .doc(activeGenerationId(f.tenantA.tenant.id, setup.order.id))
          .get()
      ).exists,
    ).toBe(false);
    expect(
      (await orderDocs(f, 'financialOrderStates').doc(setup.order.id).get()).data(),
    ).toMatchObject({ cashReceivedCents: 9, cashSettledCents: 9 });
  });
});
