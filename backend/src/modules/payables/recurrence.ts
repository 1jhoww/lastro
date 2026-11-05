import type { RecurringExpense } from '../../shared/schemas/management.js';

/** Titles are issued this many days before they fall due, so they appear in the projection. */
export const GENERATION_HORIZON_DAYS = 35;
/** A company back after a long gap is not billed for every missed occurrence at once. */
export const CATCH_UP_DAYS = 60;

const step = { monthly: 1, quarterly: 3, yearly: 12 } as const;
const pad = (n: number) => String(n).padStart(2, '0');

/** The due day of a month, or its last day when the month is shorter. */
function dateIn(year: number, monthIndex: number, dueDay: number) {
  const normalized = new Date(Date.UTC(year, monthIndex, 1));
  const y = normalized.getUTCFullYear();
  const m = normalized.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${pad(m + 1)}-${pad(Math.min(dueDay, last))}`;
}

export type Schedule = Pick<
  RecurringExpense,
  'frequency' | 'dueDay' | 'startDate' | 'endDate' | 'generatedThrough'
>;

/** Due dates after `generatedThrough`, from the start date up to `through` and the end date. */
export function dueDatesThrough(recurrence: Schedule, through: string, limit = 24): string[] {
  const [year, month] = recurrence.startDate.split('-').map(Number) as [number, number];
  const last = recurrence.endDate && recurrence.endDate < through ? recurrence.endDate : through;
  const dates: string[] = [];
  for (let i = 0; dates.length < limit; i++) {
    const date = dateIn(year, month - 1 + i * step[recurrence.frequency], recurrence.dueDay);
    if (date > last) break;
    if (
      date >= recurrence.startDate &&
      (!recurrence.generatedThrough || date > recurrence.generatedThrough)
    )
      dates.push(date);
  }
  return dates;
}

export function nextDueDate(
  recurrence: Schedule & Pick<RecurringExpense, 'status'>,
  today: string,
) {
  if (recurrence.status !== 'active') return null;
  const horizon = `${Number(today.slice(0, 4)) + 2}${today.slice(4)}`;
  return (
    dueDatesThrough(
      {
        ...recurrence,
        generatedThrough:
          recurrence.generatedThrough && recurrence.generatedThrough > today
            ? recurrence.generatedThrough
            : today,
      },
      horizon,
      1,
    )[0] ?? null
  );
}
