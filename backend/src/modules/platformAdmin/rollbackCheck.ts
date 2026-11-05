import { FieldPath, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';

const PAGE_SIZE = 200;

export type RollbackBlocker =
  | 'plan_gestao'
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
  const contracts = await db.collection('subscriptions').where('planCode', '==', 'gestao').get();
  for (const doc of contracts.docs)
    blockers.push({ tenantId: String(doc.get('tenantId')), reason: 'plan_gestao' });
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
