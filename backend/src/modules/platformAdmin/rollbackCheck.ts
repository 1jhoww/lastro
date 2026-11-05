import { FieldPath, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';

const PAGE_SIZE = 200;

export type RollbackBlocker =
  | 'plan_gestao'
  | 'plan_custom'
  | 'charge_gestao'
  | 'charge_custom'
  | 'supplier_record'
  | 'customer_contact'
  | 'purchase_stock_movement';

/**
 * Says whether the API version before Lastro Gestão can still read the database. That version has
 * strict schemas, so one record with a new field or value makes it fail. Reads only, and reports
 * ids and reasons: it never returns the content of a record.
 */
export async function rollbackBlockers(db: Firestore) {
  const blockers: { tenantId: string; reason: RollbackBlocker }[] = [];
  const contracts = await db
    .collection('subscriptions')
    .where('planCode', 'in', ['gestao', 'custom'])
    .get();
  for (const doc of contracts.docs)
    blockers.push({
      tenantId: String(doc.get('tenantId')),
      reason: doc.get('planCode') === 'custom' ? 'plan_custom' : 'plan_gestao',
    });
  // A charge keeps the plan it was issued under, so it outlives the contract moving to another plan.
  const charges = await db
    .collection('billingCharges')
    .where('planCode', 'in', ['gestao', 'custom'])
    .select('tenantId', 'planCode')
    .get();
  const chargeBlockers = new Set<string>();
  for (const doc of charges.docs) {
    const tenantId = String(doc.get('tenantId'));
    const reason: RollbackBlocker =
      doc.get('planCode') === 'custom' ? 'charge_custom' : 'charge_gestao';
    if (chargeBlockers.has(`${tenantId}:${reason}`)) continue;
    chargeBlockers.add(`${tenantId}:${reason}`);
    blockers.push({ tenantId, reason });
  }
  const tenants = db
    .collection('tenants')
    .orderBy(FieldPath.documentId())
    .select()
    .limit(PAGE_SIZE);
  let examined = 0;
  let last: QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await (last ? tenants.startAfter(last) : tenants).get();
    for (const tenant of page.docs) {
      examined++;
      const customers = tenant.ref.collection('customers');
      const [suppliers, contacts, movements] = await Promise.all([
        customers.where('isSupplier', '==', true).select().limit(1).get(),
        customers.where('contactName', '>', '').select().limit(1).get(),
        tenant.ref
          .collection('inventoryMovements')
          .where('origin', '==', 'purchase')
          .select()
          .limit(1)
          .get(),
      ]);
      if (!suppliers.empty) blockers.push({ tenantId: tenant.id, reason: 'supplier_record' });
      if (!contacts.empty) blockers.push({ tenantId: tenant.id, reason: 'customer_contact' });
      if (!movements.empty)
        blockers.push({ tenantId: tenant.id, reason: 'purchase_stock_movement' });
    }
    if (page.size < PAGE_SIZE) break;
    last = page.docs[page.docs.length - 1];
  }
  return { tenants: examined, rollbackSafe: blockers.length === 0, blockers };
}
