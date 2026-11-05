import { beforeEach, describe, expect, it } from 'vitest';
import { registerFixture } from '../helpers/fixture.js';
import { api, gestao } from '../helpers/management.js';
import { FoundationRepository } from '../../src/infrastructure/repositories/foundationRepository.js';
import { CommercialRepository } from '../../src/infrastructure/repositories/commercialRepository.js';
import { AccessService } from '../../src/modules/auth/accessService.js';
import { FinancialCommands } from '../../src/modules/finance/financialCommands.js';
import { PaymentSettingsService } from '../../src/modules/finance/paymentSettingsService.js';
import { PayableService } from '../../src/modules/payables/payableService.js';
import { RecurringService } from '../../src/modules/payables/recurringService.js';
import { runRecurringGeneration, type RunLog } from '../../src/modules/payables/recurringRun.js';

const f = registerFixture();

function service() {
  const repo = new FoundationRepository(f.firebase.db);
  const commands = new FinancialCommands(
    new CommercialRepository(repo, 'segredo-de-teste-com-tamanho-suficiente'),
    new AccessService(repo),
    () => new Date(),
  );
  return new RecurringService(
    commands,
    new PayableService(commands, new PaymentSettingsService(commands)),
  );
}
const silent: RunLog = () => {};
const today = () => new Date().toISOString().slice(0, 10);

/** A recurrence with its titles removed, as if the job had never run for it. */
async function pending(tenantId: string, user = f.ownerA, description = 'Internet') {
  const created = await api(f, tenantId, user)
    .post('/recurring-expenses', {
      description,
      amountCents: 15900,
      frequency: 'monthly',
      dueDay: 28,
      startDate: today(),
    })
    .expect(201);
  const id = created.body.data.id as string;
  const titles = await f.firebase.db
    .collection(`tenants/${tenantId}/payables`)
    .where('originReference', '==', id)
    .get();
  for (const doc of titles.docs) await doc.ref.delete();
  await f.firebase.db.doc(`tenants/${tenantId}/recurringExpenses/${id}`).update({
    generatedThrough: null,
  });
  return id;
}
const issued = async (tenantId: string, id: string) =>
  (
    await f.firebase.db
      .collection(`tenants/${tenantId}/payables`)
      .where('originReference', '==', id)
      .get()
  ).size;

const tenantA = () => f.tenantA.tenant.id;
const tenantB = () => f.tenantB.tenant.id;

beforeEach(async () => {
  await gestao(f);
});

describe('Geração diária de títulos recorrentes', () => {
  it('simulação não grava; execução cria; repetição não duplica', async () => {
    const id = await pending(tenantA());
    const simulated = await runRecurringGeneration({
      db: f.firebase.db,
      recurring: service(),
      dryRun: true,
      log: silent,
    });
    expect(simulated.dryRun).toBe(true);
    expect(simulated.created).toBeGreaterThan(0);
    expect(await issued(tenantA(), id)).toBe(0);
    const run = await runRecurringGeneration({
      db: f.firebase.db,
      recurring: service(),
      log: silent,
    });
    expect(run).toMatchObject({ created: simulated.created, failed: 0, dryRun: false });
    expect(await issued(tenantA(), id)).toBe(simulated.created);
    const again = await runRecurringGeneration({
      db: f.firebase.db,
      recurring: service(),
      log: silent,
    });
    expect(again).toMatchObject({ created: 0, failed: 0 });
    expect(await issued(tenantA(), id)).toBe(simulated.created);
  });

  it('execuções simultâneas não duplicam', async () => {
    const id = await pending(tenantA());
    const runs = await Promise.all(
      [1, 2, 3].map(() =>
        runRecurringGeneration({ db: f.firebase.db, recurring: service(), log: silent }),
      ),
    );
    const total = runs.reduce((t, r) => t + r.created, 0);
    expect(total).toBe(await issued(tenantA(), id));
  });

  it('ignora plano sem o recurso e contrato suspenso, sem apagar nada', async () => {
    const id = await pending(tenantA());
    await f.firebase.db
      .doc(`subscriptions/${tenantA()}`)
      .update({ planCode: 'essencial', userLimit: 1 });
    const other = await runRecurringGeneration({
      db: f.firebase.db,
      recurring: service(),
      log: silent,
    });
    expect(other.contracts).toBe(0);
    expect(await issued(tenantA(), id)).toBe(0);
    await gestao(f);
    await f.firebase.db.doc(`subscriptions/${tenantA()}`).update({ status: 'suspended' });
    const suspended = await runRecurringGeneration({
      db: f.firebase.db,
      recurring: service(),
      log: silent,
    });
    expect(suspended).toMatchObject({ contracts: 1, skipped: 1, created: 0 });
    expect(await issued(tenantA(), id)).toBe(0);
  });

  it('falha em uma recorrência não impede as outras', async () => {
    const good = await pending(tenantA(), f.ownerA, 'Aluguel');
    const bad = await pending(tenantA(), f.ownerA, 'Quebrada');
    await f.firebase.db
      .doc(`tenants/${tenantA()}/recurringExpenses/${bad}`)
      .update({ amountCents: 'inválido' });
    const events: { event: string; recurrenceId?: unknown }[] = [];
    const run = await runRecurringGeneration({
      db: f.firebase.db,
      recurring: service(),
      log: (_severity, event, fields) => events.push({ event, ...fields }),
    });
    expect(run.failed).toBe(1);
    expect(await issued(tenantA(), good)).toBeGreaterThan(0);
    const failure = events.find((e) => e.event === 'recurring.generation.recurrence_failed');
    expect(failure?.recurrenceId).toBe(bad);
    expect(events.at(-1)?.event).toBe('recurring.generation.completed');
  });

  it('falha em uma empresa não impede as outras', async () => {
    await gestao(f, tenantB());
    const good = await pending(tenantB(), f.ownerB);
    await f.firebase.db
      .doc(`subscriptions/${tenantA()}`)
      .update({ tenantId: 'empresa-inexistente' });
    const events: string[] = [];
    const run = await runRecurringGeneration({
      db: f.firebase.db,
      recurring: service(),
      log: (_severity, event) => events.push(event),
    });
    await f.firebase.db.doc(`subscriptions/${tenantA()}`).update({ tenantId: tenantA() });
    expect(run.failed).toBe(1);
    expect(events).toContain('recurring.generation.company_failed');
    expect(await issued(tenantB(), good)).toBeGreaterThan(0);
  });

  it('títulos ficam isolados por empresa', async () => {
    await gestao(f, tenantB());
    const mine = await pending(tenantA());
    await runRecurringGeneration({ db: f.firebase.db, recurring: service(), log: silent });
    expect(await issued(tenantB(), mine)).toBe(0);
    expect(await issued(tenantA(), mine)).toBeGreaterThan(0);
  });
});
