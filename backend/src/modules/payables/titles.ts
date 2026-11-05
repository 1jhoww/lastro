import type { z } from 'zod';
import type { Actor } from '../../shared/types/context.js';
import type { Customer } from '../../shared/schemas/commercial.js';
import {
  payableSchema,
  type Payable,
  type payableSituation,
  type Purchase,
  type RecurringExpense,
} from '../../shared/schemas/management.js';
import { digest } from '../../shared/utils/crypto.js';

/** Category of titles born from purchases: stock, not an operating expense. */
export const PURCHASE_CATEGORY = 'Compras de mercadorias';

/** Overdue is derived from the date and the balance, so it can never go stale in storage. */
export function situationOf(
  title: Pick<Payable, 'status' | 'dueDate' | 'hasBalance'>,
  today: string,
): z.infer<typeof payableSituation> {
  return title.hasBalance && title.dueDate < today ? 'overdue' : title.status;
}
/** Status of a title from its amounts. */
export const titleStatus = (title: Pick<Payable, 'outstandingCents' | 'paidCents'>) =>
  title.outstandingCents === 0
    ? ('paid' as const)
    : title.paidCents > 0
      ? ('partially_paid' as const)
      : ('open' as const);

const base = (actor: Actor, now: string) => ({
  paidCents: 0,
  canceledCents: 0,
  paidOn: null,
  status: 'open' as const,
  hasBalance: true,
  paymentCount: 0,
  version: 1,
  createdAt: now,
  updatedAt: now,
  createdBy: actor.uid,
  updatedBy: actor.uid,
  canceledAt: null,
  cancelReason: null,
  schemaVersion: 1 as const,
});

export const purchaseTitleId = (purchase: Pick<Purchase, 'id' | 'titleGeneration'>, n: number) =>
  digest(`payable:${purchase.id}:${purchase.titleGeneration}:${n}`);

/** One installment of a confirmed purchase, with its own due date and payments. */
export function purchaseTitle(
  purchase: Purchase,
  supplier: Pick<Customer, 'id' | 'name'>,
  row: { number: number; amountCents: number; dueDate: string },
  count: number,
  actor: Actor,
  now: string,
): Payable {
  return payableSchema.parse({
    ...base(actor, now),
    id: purchaseTitleId(purchase, row.number),
    tenantId: purchase.tenantId,
    beneficiaryId: supplier.id,
    beneficiaryName: supplier.name,
    description:
      count > 1
        ? `Compra #${purchase.commercialId} · parcela ${row.number}/${count}`
        : `Compra #${purchase.commercialId}`,
    categoryId: null,
    categoryName: PURCHASE_CATEGORY,
    origin: 'purchase',
    originReference: purchase.id,
    installmentNumber: row.number,
    installmentCount: count,
    originalCents: row.amountCents,
    outstandingCents: row.amountCents,
    issueDate: purchase.purchaseDate,
    competenceDate: purchase.purchaseDate,
    dueDate: row.dueDate,
    notes: '',
  });
}

export const recurringTitleId = (recurrenceId: string, dueDate: string) =>
  digest(`recurring:${recurrenceId}:${dueDate}`);

/** Occurrence of a recurrence. The id comes from recurrence and date: it can only exist once. */
export function recurringTitle(
  recurrence: RecurringExpense,
  dueDate: string,
  issueDate: string,
  actor: Actor,
  now: string,
): Payable {
  return payableSchema.parse({
    ...base(actor, now),
    id: recurringTitleId(recurrence.id, dueDate),
    tenantId: recurrence.tenantId,
    beneficiaryId: recurrence.beneficiaryId,
    beneficiaryName: recurrence.beneficiaryName,
    description: recurrence.description,
    categoryId: recurrence.categoryId,
    categoryName: recurrence.categoryName,
    origin: 'recurring',
    originReference: recurrence.id,
    installmentNumber: null,
    installmentCount: null,
    originalCents: recurrence.amountCents,
    outstandingCents: recurrence.amountCents,
    issueDate,
    competenceDate: dueDate,
    dueDate,
    notes: recurrence.notes,
  });
}

export function manualTitle(input: {
  id: string;
  tenantId: string;
  origin: 'expense' | 'manual';
  beneficiaryId: string | null;
  beneficiaryName: string | null;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  amountCents: number;
  issueDate: string;
  dueDate: string;
  notes: string;
  actor: Actor;
  now: string;
}): Payable {
  const { amountCents, actor, now, ...fields } = input;
  return payableSchema.parse({
    ...base(actor, now),
    ...fields,
    originReference: null,
    installmentNumber: null,
    installmentCount: null,
    originalCents: amountCents,
    outstandingCents: amountCents,
    competenceDate: input.issueDate,
  });
}

/**
 * Takes value off the open balance, leaving payments as they are. A title that ends up with nothing
 * paid was never owed; one with payments counts as paid, on the date given.
 */
export function abatedTitle(
  title: Payable,
  cents: number,
  actor: Actor,
  reason: string,
  date: string,
  now: string,
): Payable {
  const outstandingCents = title.outstandingCents - cents;
  const settled = outstandingCents === 0;
  const voided = settled && title.paidCents === 0;
  return payableSchema.parse({
    ...title,
    outstandingCents,
    canceledCents: title.canceledCents + cents,
    hasBalance: !settled,
    status: voided ? 'canceled' : settled ? 'paid' : title.status,
    paidOn: settled && !voided ? date : title.paidOn,
    canceledAt: voided ? now : title.canceledAt,
    cancelReason: voided ? reason : title.cancelReason,
    version: title.version + 1,
    updatedAt: now,
    updatedBy: actor.uid,
  });
}

/** A supplier credit settles the title like a payment would, without money leaving. */
export function creditedTitle(
  title: Payable,
  cents: number,
  actor: Actor,
  date: string,
  now: string,
): Payable {
  const outstandingCents = title.outstandingCents - cents;
  const settled = outstandingCents === 0;
  return payableSchema.parse({
    ...title,
    outstandingCents,
    canceledCents: title.canceledCents + cents,
    hasBalance: !settled,
    status: settled ? 'paid' : title.status,
    paidOn: settled ? date : title.paidOn,
    version: title.version + 1,
    updatedAt: now,
    updatedBy: actor.uid,
  });
}

/** Undoes `creditedTitle`, including over an abatement that closed the title afterwards. */
export function uncreditedTitle(title: Payable, cents: number, actor: Actor, now: string): Payable {
  const outstandingCents = title.outstandingCents + cents;
  return payableSchema.parse({
    ...title,
    outstandingCents,
    canceledCents: title.canceledCents - cents,
    hasBalance: true,
    status: titleStatus({ outstandingCents, paidCents: title.paidCents }),
    paidOn: null,
    canceledAt: null,
    cancelReason: null,
    version: title.version + 1,
    updatedAt: now,
    updatedBy: actor.uid,
  });
}

export function canceledTitle(title: Payable, actor: Actor, reason: string, now: string): Payable {
  return payableSchema.parse({
    ...title,
    canceledCents: title.canceledCents + title.outstandingCents,
    outstandingCents: 0,
    hasBalance: false,
    status: 'canceled',
    canceledAt: now,
    cancelReason: reason,
    version: title.version + 1,
    updatedAt: now,
    updatedBy: actor.uid,
  });
}
