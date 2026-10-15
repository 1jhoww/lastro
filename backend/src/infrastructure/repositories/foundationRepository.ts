import type {
  Firestore,
  Transaction,
  DocumentReference,
  DocumentSnapshot,
} from 'firebase-admin/firestore';
import type { z } from 'zod';
import { opaqueId } from '../../shared/schemas/models.js';
import { AppError } from '../../shared/errors/appError.js';
import { EconomicView } from '../../modules/finance/resolution/economicView.js';
import { ReadGate, accountRead, checkReadBudget } from '../../shared/operations/readBudget.js';
export class FoundationRepository {
  readonly readBudget = new ReadGate(4);
  private readonly economicViews = new WeakMap<Transaction, EconomicView>();
  constructor(readonly db: Firestore) {}
  private economicView(tx?: Transaction): EconomicView {
    const prior = tx ? this.economicViews.get(tx) : undefined;
    if (prior) return prior;
    const view = new EconomicView(
      async (tenantId, collection, id) => {
        checkReadBudget();
        const ref = this.db
          .collection('tenants')
          .doc(opaqueId.parse(tenantId))
          .collection(collection)
          .doc(opaqueId.parse(id));
        const proof = tx ? await tx.get(ref) : await ref.get();
        accountRead(proof.data());
        return proof.exists ? proof.data() : null;
      },
      async (tenantId, returnId) => {
        checkReadBudget();
        const query = this.db
          .collection('tenants')
          .doc(opaqueId.parse(tenantId))
          .collection('returnEvents')
          .where('returnId', '==', opaqueId.parse(returnId))
          .where('schemaVersion', '==', 2)
          .orderBy('sequence', 'desc')
          .limit(1);
        const page = tx ? await tx.get(query) : await query.get();
        accountRead(page.empty ? null : page.docs[0]!.data());
        return page.empty ? null : page.docs[0]!.data();
      },
    );
    if (tx) this.economicViews.set(tx, view);
    return view;
  }
  async provenSource(
    tenantId: string,
    collection: string,
    id: string,
    executionId: string,
    tx: Transaction,
  ) {
    return this.economicView(tx).publishedSource(tenantId, collection, id, executionId);
  }
  global(
    collection:
      | 'identities'
      | 'tenants'
      | 'plans'
      | 'subscriptions'
      | 'platformAdmins'
      | 'auditLogs'
      | 'idempotencyRecords'
      | 'catalogSlugs'
      | 'rateLimits',
    id: string,
  ): DocumentReference {
    return this.db.collection(collection).doc(opaqueId.parse(id));
  }
  tenant(
    tenantId: string,
    collection: 'memberships' | 'invitations' | 'invitationEmails' | 'auditLogs',
    id: string,
  ): DocumentReference {
    return this.db
      .collection('tenants')
      .doc(opaqueId.parse(tenantId))
      .collection(collection)
      .doc(opaqueId.parse(id));
  }
  async read<T>(ref: DocumentReference, schema: z.ZodType<T>, tx?: Transaction): Promise<T | null> {
    checkReadBudget();
    const snapshot = tx ? await tx.get(ref) : await ref.get();
    return this.readSnapshot(snapshot, schema, tx);
  }
  async readSnapshot<T>(
    snapshot: DocumentSnapshot,
    schema: z.ZodType<T>,
    tx?: Transaction,
  ): Promise<T | null> {
    checkReadBudget();
    if (!snapshot.exists) return null;
    const path = snapshot.ref.path.split('/');
    let raw: unknown = snapshot.data();
    accountRead(raw);
    if (path.length === 4 && path[0] === 'tenants') {
      raw = await this.economicView(tx).resolve(path[1]!, path[2]!, path[3]!, raw);
    }
    const parsed = schema.safeParse(raw);
    checkReadBudget();
    if (!parsed.success) throw new AppError(500, 'INTERNAL_ERROR', 'Erro interno do servidor');
    return parsed.data;
  }
}
