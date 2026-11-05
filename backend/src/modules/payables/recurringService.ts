import { randomUUID } from 'node:crypto';
import { FieldPath, type QueryDocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { Actor } from '../../shared/types/context.js';
import * as s from '../../shared/schemas/management.js';
import { searchKey } from '../../shared/schemas/commercial.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { recordAudit } from '../../shared/audit/audit.js';
import { digest, stableJson } from '../../shared/utils/crypto.js';
import { cursorPage } from '../../shared/operations/cursorPage.js';
import type { FinancialCommands } from '../finance/financialCommands.js';
import { companyDate } from '../orders/calculation.js';
import { addDays } from '../reports/dates.js';
import type { PayableService } from './payableService.js';
import {
  CATCH_UP_DAYS,
  GENERATION_HORIZON_DAYS,
  dueDatesThrough,
  nextDueDate,
} from './recurrence.js';
import { recurringTitle, recurringTitleId } from './titles.js';

const RECURRENCE_PAGE = 200;

export const defaultCategories = [
  'Aluguel',
  'Energia',
  'Internet',
  'Combustível',
  'Serviços',
  'Marketing',
  'Manutenção',
  'Salários',
] as const;

/** Expense categories and recurring expenses of the company. */
export class RecurringService {
  constructor(
    readonly commands: FinancialCommands,
    readonly payables: PayableService,
  ) {}
  private get repo() {
    return this.commands.repo;
  }
  private view(recurrence: s.RecurringExpense, today: string) {
    return s.recurringExpenseView.parse({
      ...recurrence,
      nextDueDate: nextDueDate(recurrence, today),
    });
  }
  private async load(tx: Transaction, tenantId: string, id: string) {
    const recurrence = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'recurringExpenses', id),
      s.recurringExpenseSchema,
      tx,
    );
    requireCondition(
      recurrence?.id === id && recurrence.tenantId === tenantId,
      404,
      'RESOURCE_NOT_FOUND',
      'Recurso não encontrado',
    );
    return recurrence;
  }
  /* ---------- Categories ---------- */
  async categories(actor: Actor, tenantId: string, input: z.infer<typeof s.expenseCategoryQuery>) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'payables:read', tx);
        const status = input.status ?? 'active';
        const base = this.repo.ref(tenantId, 'expenseCategories', 'placeholder').parent;
        const query = status === 'all' ? base : base.where('status', '==', status);
        return cursorPage({
          repo: this.repo,
          tx,
          tenantId,
          collection: 'expenseCategories',
          scope: digest(stableJson({ actor: actor.uid, tenantId, ...input, cursor: undefined })),
          query: query.orderBy('nameKey').orderBy(FieldPath.documentId()),
          input,
          schema: s.expenseCategorySchema,
        });
      },
      { readOnly: true },
    );
  }
  private categoryRecord(tenantId: string, id: string, name: string, uid: string, now: string) {
    return s.expenseCategorySchema.parse({
      id,
      tenantId,
      name,
      nameKey: searchKey(name),
      status: 'active',
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: uid,
      updatedBy: uid,
      schemaVersion: 1,
    });
  }
  createCategory(
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof s.expenseCategoryCreate>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'expense-category.create',
      'new',
      input,
      'payables:manage',
      s.expenseCategoryView,
      false,
      async (tx, _ctx, _operationId, now) => {
        // The id comes from the name, so two simultaneous creations cannot both succeed.
        const id = digest(`category:${searchKey(input.name)}`);
        const ref = this.repo.ref(tenantId, 'expenseCategories', id);
        await this.requireFreeName(tx, tenantId, searchKey(input.name));
        requireCondition(
          !(await tx.get(ref)).exists,
          409,
          'DUPLICATE_CATEGORY',
          'Categoria já cadastrada',
        );
        const category = this.categoryRecord(tenantId, id, input.name, actor.uid, now);
        tx.create(ref, category);
        recordAudit(
          this.repo.foundation,
          tx,
          actor,
          tenantId,
          'expense-category.created',
          id,
          now,
          {
            name: category.name,
          },
        );
        return s.expenseCategoryView.parse(category);
      },
    );
  }
  private async requireFreeName(tx: Transaction, tenantId: string, nameKey: string) {
    const same = await tx.get(
      this.repo
        .ref(tenantId, 'expenseCategories', 'placeholder')
        .parent.where('nameKey', '==', nameKey)
        .limit(1),
    );
    requireCondition(same.empty, 409, 'DUPLICATE_CATEGORY', 'Categoria já cadastrada');
  }
  updateCategory(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.expenseCategoryUpdate>,
    key: string,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'expense-category.update',
      id,
      input,
      'payables:manage',
      s.expenseCategoryView,
      false,
      async (tx, _ctx, _operationId, now) => {
        const ref = this.repo.ref(tenantId, 'expenseCategories', id);
        const category = await this.repo.foundation.read(ref, s.expenseCategorySchema, tx);
        requireCondition(
          category?.tenantId === tenantId && category.id === id,
          404,
          'RESOURCE_NOT_FOUND',
          'Recurso não encontrado',
        );
        requireCondition(
          category.version === input.expectedVersion,
          409,
          'CONFLICT',
          'Versão desatualizada',
        );
        const name = input.name ?? category.name;
        if (searchKey(name) !== category.nameKey)
          await this.requireFreeName(tx, tenantId, searchKey(name));
        const next = s.expenseCategorySchema.parse({
          ...category,
          name,
          nameKey: searchKey(name),
          status: input.status ?? category.status,
          version: category.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        });
        tx.set(ref, next);
        recordAudit(
          this.repo.foundation,
          tx,
          actor,
          tenantId,
          'expense-category.updated',
          id,
          now,
          {
            fields: Object.keys(input).filter((k) => k !== 'expectedVersion'),
          },
        );
        return s.expenseCategoryView.parse(next);
      },
    );
  }
  /** Common categories, on request. Repeating creates nothing and keeps renamed ones. */
  seedCategories(actor: Actor, tenantId: string, key: string) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      'expense-category.seed',
      'new',
      {},
      'payables:manage',
      s.seededCategories,
      false,
      async (tx, _ctx, _operationId, now) => {
        const rows = defaultCategories.map((name) => ({
          name,
          id: digest(`category:${searchKey(name)}`),
        }));
        const existing = await this.repo.foundation.readMany(
          rows.map((r) => this.repo.ref(tenantId, 'expenseCategories', r.id)),
          s.expenseCategorySchema,
          tx,
        );
        const missing = rows.filter((_row, index) => !existing[index]);
        for (const row of missing)
          tx.create(
            this.repo.ref(tenantId, 'expenseCategories', row.id),
            this.categoryRecord(tenantId, row.id, row.name, actor.uid, now),
          );
        return { created: missing.length };
      },
    );
  }
  /* ---------- Recurring expenses ---------- */
  async list(actor: Actor, tenantId: string, input: z.infer<typeof s.recurringExpenseQuery>) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        const ctx = await this.commands.access.tenant(actor, tenantId, 'payables:read', tx);
        const today = companyDate(this.commands.clock(), ctx.tenant.timezone);
        const base = this.repo.ref(tenantId, 'recurringExpenses', 'placeholder').parent;
        const query = input.status ? base.where('status', '==', input.status) : base;
        const page = await cursorPage({
          repo: this.repo,
          tx,
          tenantId,
          collection: 'recurringExpenses',
          scope: digest(stableJson({ actor: actor.uid, tenantId, ...input, cursor: undefined })),
          query: query.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc'),
          input,
          schema: s.recurringExpenseSchema,
        });
        return { items: page.items.map((r) => this.view(r, today)), nextCursor: page.nextCursor };
      },
      { readOnly: true },
    );
  }
  async get(actor: Actor, tenantId: string, id: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        const ctx = await this.commands.access.tenant(actor, tenantId, 'payables:read', tx);
        return this.view(
          await this.load(tx, tenantId, id),
          companyDate(this.commands.clock(), ctx.tenant.timezone),
        );
      },
      { readOnly: true },
    );
  }
  async create(
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof s.recurringExpenseCreate>,
    key: string,
  ) {
    const id = randomUUID();
    const created = await this.commands.execute(
      actor,
      tenantId,
      key,
      'recurring.create',
      'new',
      input,
      'payables:manage',
      s.recurringExpenseView,
      false,
      async (tx, ctx, _operationId, now) => {
        const recurrence = s.recurringExpenseSchema.parse({
          id,
          tenantId,
          description: input.description,
          amountCents: input.amountCents,
          ...(await this.payables.category(tx, tenantId, input.categoryId)),
          ...(await this.payables.beneficiary(
            tx,
            tenantId,
            input.beneficiaryId,
            input.beneficiaryName,
          )),
          frequency: input.frequency,
          dueDay: input.dueDay,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          status: 'active',
          generatedThrough: null,
          notes: input.notes ?? '',
          version: 1,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.uid,
          updatedBy: actor.uid,
          schemaVersion: 1,
        });
        tx.create(this.repo.ref(tenantId, 'recurringExpenses', id), recurrence);
        recordAudit(this.repo.foundation, tx, actor, tenantId, 'recurring.created', id, now, {
          amountCents: recurrence.amountCents,
          frequency: recurrence.frequency,
        });
        return this.view(recurrence, companyDate(new Date(now), ctx.tenant.timezone));
      },
    );
    await this.advance(actor, tenantId, created.id);
    return this.get(actor, tenantId, created.id);
  }
  /**
   * New terms apply to what was not paid yet: open titles due after today follow them, while
   * paid, partially paid and past titles stay exactly as they were.
   */
  async update(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.recurringExpenseUpdate>,
    key: string,
  ) {
    await this.commands.execute(
      actor,
      tenantId,
      key,
      'recurring.update',
      id,
      input,
      'payables:manage',
      s.recurringExpenseView,
      false,
      async (tx, ctx, _operationId, now) => {
        const recurrence = await this.load(tx, tenantId, id);
        requireCondition(
          recurrence.version === input.expectedVersion,
          409,
          'CONFLICT',
          'Versão desatualizada',
        );
        requireCondition(
          recurrence.status !== 'ended',
          409,
          'RECURRENCE_ENDED',
          'Recorrência encerrada não pode ser alterada',
        );
        const today = companyDate(new Date(now), ctx.tenant.timezone);
        const category =
          input.categoryId !== undefined
            ? await this.payables.category(tx, tenantId, input.categoryId)
            : {};
        const beneficiary =
          input.beneficiaryId !== undefined || input.beneficiaryName !== undefined
            ? await this.payables.beneficiary(
                tx,
                tenantId,
                input.beneficiaryId,
                input.beneficiaryName,
              )
            : {};
        const { expectedVersion: _version, ...changes } = input;
        const next = s.recurringExpenseSchema.parse({
          ...recurrence,
          ...changes,
          ...category,
          ...beneficiary,
          version: recurrence.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        });
        requireCondition(
          !next.endDate || next.endDate >= next.startDate,
          422,
          'VALIDATION_ERROR',
          'Término antes do início',
        );
        const issued = await tx.get(
          this.repo
            .ref(tenantId, 'payables', 'placeholder')
            .parent.where('originReference', '==', id)
            .limit(120),
        );
        const open = issued.docs
          .map((doc) => s.payableSchema.parse(doc.data()))
          .filter((t) => t.status === 'open' && t.paidCents === 0 && t.dueDate > today);
        for (const title of open)
          tx.set(
            this.repo.ref(tenantId, 'payables', title.id),
            s.payableSchema.parse({
              ...title,
              description: next.description,
              categoryId: next.categoryId,
              categoryName: next.categoryName,
              beneficiaryId: next.beneficiaryId,
              beneficiaryName: next.beneficiaryName,
              originalCents: next.amountCents,
              outstandingCents: next.amountCents,
              version: title.version + 1,
              updatedAt: now,
              updatedBy: actor.uid,
            }),
          );
        tx.set(this.repo.ref(tenantId, 'recurringExpenses', id), next);
        recordAudit(this.repo.foundation, tx, actor, tenantId, 'recurring.updated', id, now, {
          fields: Object.keys(changes),
          futureTitlesUpdated: open.length,
        });
        return this.view(next, today);
      },
    );
    await this.advance(actor, tenantId, id);
    return this.get(actor, tenantId, id);
  }
  async command(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.recurringExpenseCommand>,
    key: string,
  ) {
    await this.commands.execute(
      actor,
      tenantId,
      key,
      `recurring.${input.action}`,
      id,
      input,
      'payables:manage',
      s.recurringExpenseView,
      false,
      async (tx, ctx, _operationId, now) => {
        const recurrence = await this.load(tx, tenantId, id);
        requireCondition(
          recurrence.version === input.expectedVersion,
          409,
          'CONFLICT',
          'Versão desatualizada',
        );
        requireCondition(
          recurrence.status !== 'ended',
          409,
          'RECURRENCE_ENDED',
          'Recorrência já encerrada',
        );
        const today = companyDate(new Date(now), ctx.tenant.timezone);
        const yesterday = addDays(today, -1);
        const generatedThrough =
          // What was skipped while paused is not charged afterwards.
          input.action === 'resume' &&
          (!recurrence.generatedThrough || recurrence.generatedThrough < yesterday)
            ? yesterday
            : recurrence.generatedThrough;
        const next = s.recurringExpenseSchema.parse({
          ...recurrence,
          status:
            input.action === 'pause' ? 'paused' : input.action === 'resume' ? 'active' : 'ended',
          endDate: input.action === 'end' ? today : recurrence.endDate,
          generatedThrough,
          version: recurrence.version + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        });
        tx.set(this.repo.ref(tenantId, 'recurringExpenses', id), next);
        recordAudit(
          this.repo.foundation,
          tx,
          actor,
          tenantId,
          `recurring.${input.action}`,
          id,
          now,
          {},
        );
        return this.view(next, today);
      },
    );
    if (input.action === 'resume') await this.advance(actor, tenantId, id);
    return this.get(actor, tenantId, id);
  }
  /** Issues what is due on demand, for companies waiting for the daily job. */
  async generate(actor: Actor, tenantId: string) {
    const ctx = await this.commands.access.tenant(actor, tenantId, 'payables:manage');
    return this.generateFor(actor, ctx.tenant.id, ctx.tenant.timezone);
  }
  /**
   * Used by the job too: every active recurrence, each one in its own transaction, so one that
   * fails is counted and does not stop the others.
   */
  async generateFor(
    actor: Actor,
    tenantId: string,
    timezone: string,
    options: { dryRun?: boolean; onFailure?: (id: string, error: unknown) => void } = {},
  ) {
    const active = this.repo
      .ref(tenantId, 'recurringExpenses', 'placeholder')
      .parent.where('status', '==', 'active')
      .orderBy(FieldPath.documentId())
      .limit(RECURRENCE_PAGE);
    const totals = { examined: 0, created: 0, failed: 0 };
    let last: QueryDocumentSnapshot | undefined;
    for (;;) {
      const page = await (last ? active.startAfter(last) : active).get();
      for (const doc of page.docs) {
        totals.examined++;
        try {
          totals.created += await this.issue(actor, tenantId, doc.id, timezone, options.dryRun);
        } catch (error) {
          totals.failed++;
          options.onFailure?.(doc.id, error);
        }
      }
      if (page.size < RECURRENCE_PAGE) return totals;
      last = page.docs[page.docs.length - 1];
    }
  }
  private async advance(actor: Actor, tenantId: string, id: string) {
    const ctx = await this.commands.access.tenant(actor, tenantId, 'payables:read');
    await this.issue(actor, tenantId, id, ctx.tenant.timezone);
  }
  /**
   * Issues the occurrences inside the horizon. Each title's id derives from the recurrence and the
   * due date and is checked in this transaction, so a retry or a parallel job creates nothing.
   */
  private async issue(
    actor: Actor,
    tenantId: string,
    id: string,
    timezone: string,
    dryRun = false,
  ) {
    return this.repo.foundation.db.runTransaction(async (tx) => {
      const recurrence = await this.load(tx, tenantId, id);
      if (recurrence.status !== 'active') return 0;
      const now = this.commands.clock();
      const today = companyDate(now, timezone);
      const floor = addDays(today, -CATCH_UP_DAYS);
      const dates = dueDatesThrough(
        {
          ...recurrence,
          generatedThrough:
            recurrence.generatedThrough && recurrence.generatedThrough > floor
              ? recurrence.generatedThrough
              : recurrence.generatedThrough === null
                ? null
                : floor,
        },
        addDays(today, GENERATION_HORIZON_DAYS),
      );
      if (dates.length === 0) return 0;
      const refs = dates.map((date) =>
        this.repo.ref(tenantId, 'payables', recurringTitleId(id, date)),
      );
      const existing = await this.repo.foundation.readMany(refs, s.payableSchema, tx);
      if (dryRun) return existing.filter((title) => !title).length;
      const instant = now.toISOString();
      let created = 0;
      dates.forEach((date, index) => {
        if (existing[index]) return;
        tx.create(refs[index]!, recurringTitle(recurrence, date, today, actor, instant));
        created++;
      });
      tx.set(this.repo.ref(tenantId, 'recurringExpenses', id), {
        ...recurrence,
        generatedThrough: dates[dates.length - 1],
      });
      if (created)
        recordAudit(this.repo.foundation, tx, actor, tenantId, 'recurring.issued', id, instant, {
          dates,
        });
      return created;
    });
  }
}
