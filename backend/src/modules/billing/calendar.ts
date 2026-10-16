/** Billing dates are calendar dates in the timezone where Lastro operates. */
export const BILLING_TIMEZONE = 'America/Sao_Paulo';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BILLING_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date (YYYY-MM-DD) of an instant in the billing timezone. */
export function billingDate(instant: Date): string {
  return formatter.format(instant);
}

/** Adds whole days to a calendar date. */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
