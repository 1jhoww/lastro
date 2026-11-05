import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { hasFeature, type Entitlements } from '../plans/catalog.js';

/**
 * Whether a company has supplier credits to consult. Closing purchases is what creates them, so
 * the purchases feature always opens the consultation. Without it, any registered credit keeps
 * the history readable, even with no balance left: a plan change must not hide financial records.
 * The query is always scoped to the company, and this grants reading only.
 */
export async function supplierCreditsAvailable(
  db: Firestore,
  tenantId: string,
  entitlements: Entitlements,
  tx?: Transaction,
): Promise<boolean> {
  if (hasFeature(entitlements, 'purchasing.orders')) return true;
  const registered = db
    .collection('tenants')
    .doc(tenantId)
    .collection('supplierCredits')
    .select()
    .limit(1);
  return !(await (tx ? tx.get(registered) : registered.get())).empty;
}
