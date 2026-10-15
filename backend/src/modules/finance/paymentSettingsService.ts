import { FieldPath, type Transaction, type Query } from 'firebase-admin/firestore';
import type { z } from 'zod';
import type { Actor } from '../../shared/types/context.js';
import * as s from '../../shared/schemas/paymentSettings.js';
import { searchKey } from '../../shared/schemas/commercial.js';
import { pageQuery } from '../../shared/schemas/http.js';
import { digest, stableJson, decodeCursor, encodeCursor } from '../../shared/utils/crypto.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { recordAudit } from '../../shared/audit/audit.js';
import { FinancialCommands } from './financialCommands.js';
import { presetSchedule } from './paymentCalculation.js';
type Kind = 'condition' | 'method';
export class PaymentSettingsService {
  constructor(readonly commands: FinancialCommands) {}
  get repo() {
    return this.commands.repo;
  }
  private collection(kind: Kind) {
    return kind === 'condition' ? ('paymentConditions' as const) : ('paymentMethods' as const);
  }
  private schema(kind: Kind) {
    return kind === 'condition' ? s.conditionSchema : s.methodSchema;
  }
  private nameRef(tenantId: string, kind: Kind, key: string) {
    return this.repo.ref(tenantId, 'paymentSettingNames', digest(`${kind}:${key}`));
  }
  async load(tx: Transaction, tenantId: string, kind: Kind, id: string) {
    const document = await tx.get(this.repo.ref(tenantId, this.collection(kind), id));
    requireCondition(document.exists, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
    const parsed = this.schema(kind).safeParse(document.data());
    requireCondition(
      parsed.success && parsed.data.tenantId === tenantId && parsed.data.id === id,
      500,
      'INTERNAL_ERROR',
      'Erro interno do servidor',
    );
    return parsed.data;
  }
  async activeCondition(tx: Transaction, tenantId: string, id: string, version: number) {
    const value = s.conditionSchema.parse(await this.load(tx, tenantId, 'condition', id));
    requireCondition(
      value.status === 'active' && value.version === version,
      409,
      'PAYMENT_TERMS_CHANGED',
      'Condição alterada ou inativa; revise o pedido',
    );
    return value;
  }
  async activeMethod(tx: Transaction, tenantId: string, id: string, version: number) {
    const value = s.methodSchema.parse(await this.load(tx, tenantId, 'method', id));
    requireCondition(
      value.status === 'active' && value.version === version,
      409,
      'PAYMENT_METHOD_CHANGED',
      'Forma alterada ou inativa; revise a seleção',
    );
    return s.methodSnapshot.parse(value);
  }
  async read(actor: Actor, tenantId: string, kind: Kind, id: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'payment-settings:manage', tx);
        return this.load(tx, tenantId, kind, id);
      },
      { readOnly: true },
    );
  }
  async list(
    actor: Actor,
    tenantId: string,
    kind: Kind,
    input: z.infer<typeof s.settingsQuery> | z.infer<typeof pageQuery>,
    options = false,
  ) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(
          actor,
          tenantId,
          options ? 'orders:payment-options:read' : 'payment-settings:manage',
          tx,
        );
        const status = options
          ? 'active'
          : 'status' in input
            ? (input.status ?? 'active')
            : 'active';
        const scope = digest(
          stableJson({ actor: actor.uid, tenantId, kind, options, status, limit: input.limit }),
        );
        let query: Query = this.repo.ref(tenantId, this.collection(kind), 'placeholder').parent;
        if (status !== 'all') query = query.where('status', '==', status);
        query = query.orderBy('nameKey').orderBy(FieldPath.documentId());
        const cursor = decodeCursor(this.repo.secret, scope, input.cursor);
        if (cursor)
          query = query.startAfter(
            await tx.get(this.repo.ref(tenantId, this.collection(kind), cursor)),
          );
        const limit = Number(input.limit ?? '25'),
          page = await tx.get(query.limit(limit + 1));
        const docs = page.docs.slice(0, limit);
        return {
          items: docs.map((d) => {
            const parsed = this.schema(kind).safeParse(d.data());
            requireCondition(
              parsed.success && parsed.data.id === d.id && parsed.data.tenantId === tenantId,
              500,
              'INTERNAL_ERROR',
              'Erro interno do servidor',
            );
            return options
              ? (kind === 'condition' ? s.conditionOption : s.methodOption).parse(parsed.data)
              : parsed.data;
          }),
          nextCursor:
            page.size > limit
              ? encodeCursor(this.repo.secret, scope, docs[docs.length - 1]!.id)
              : null,
        };
      },
      { readOnly: true },
    );
  }
  createCondition(
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof s.conditionCreate>,
    key: string,
  ) {
    return this.create(
      actor,
      tenantId,
      'condition',
      {
        name: input.name,
        description: input.description ?? '',
        schedule: input.preset ? presetSchedule(input.preset) : input.schedule!,
      },
      key,
      s.conditionView,
    );
  }
  createMethod(actor: Actor, tenantId: string, input: z.infer<typeof s.methodCreate>, key: string) {
    return this.create(actor, tenantId, 'method', input, key, s.methodView);
  }
  private create<T extends Record<string, unknown>>(
    actor: Actor,
    tenantId: string,
    kind: Kind,
    input: { name: string } & Record<string, unknown>,
    key: string,
    output: z.ZodType<T>,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      `${kind}.create`,
      'new',
      input,
      'payment-settings:manage',
      output,
      false,
      async (tx, _ctx, id, now) => {
        const nameKey = searchKey(input.name),
          nameRef = this.nameRef(tenantId, kind, nameKey);
        requireCondition(
          !(await tx.get(nameRef)).exists,
          409,
          'DUPLICATE_PAYMENT_SETTING',
          'Nome já cadastrado nesta empresa',
        );
        const value = this.schema(kind).parse({
          ...input,
          id,
          tenantId,
          nameKey,
          status: 'active',
          version: 1,
          createdAt: now,
          updatedAt: now,
          createdBy: actor.uid,
          updatedBy: actor.uid,
          schemaVersion: 1,
        });
        tx.create(this.repo.ref(tenantId, this.collection(kind), id), value);
        tx.create(nameRef, { resourceId: id, kind, schemaVersion: 1 });
        recordAudit(this.repo.foundation, tx, actor, tenantId, `${kind}.created`, id, now, {});
        return output.parse(value);
      },
    );
  }
  updateCondition(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.conditionUpdate>,
    key: string,
  ) {
    return this.update(actor, tenantId, 'condition', id, input, key, s.conditionView);
  }
  updateMethod(
    actor: Actor,
    tenantId: string,
    id: string,
    input: z.infer<typeof s.methodUpdate>,
    key: string,
  ) {
    return this.update(actor, tenantId, 'method', id, input, key, s.methodView);
  }
  private update<T extends Record<string, unknown>>(
    actor: Actor,
    tenantId: string,
    kind: Kind,
    id: string,
    input: { expectedVersion: number; name?: string | undefined },
    key: string,
    output: z.ZodType<T>,
  ) {
    return this.commands.execute(
      actor,
      tenantId,
      key,
      `${kind}.update`,
      id,
      input,
      'payment-settings:manage',
      output,
      false,
      async (tx, _ctx, _op, now) => {
        const previous = await this.load(tx, tenantId, kind, id);
        requireCondition(
          previous.version === input.expectedVersion,
          409,
          'CONFLICT',
          'Versão desatualizada',
        );
        const nameKey = searchKey(input.name ?? previous.name),
          oldRef = this.nameRef(tenantId, kind, previous.nameKey),
          nextRef = this.nameRef(tenantId, kind, nameKey);
        const oldName = await this.repo.foundation.read(oldRef, s.settingNameSchema, tx);
        requireCondition(
          oldName?.resourceId === id && oldName.kind === kind,
          500,
          'INTERNAL_ERROR',
          'Erro interno do servidor',
        );
        if (nameKey !== previous.nameKey)
          requireCondition(
            !(await tx.get(nextRef)).exists,
            409,
            'DUPLICATE_PAYMENT_SETTING',
            'Nome já cadastrado nesta empresa',
          );
        const { expectedVersion: _version, ...changes } = input;
        const next = this.schema(kind).parse({
          ...previous,
          ...changes,
          nameKey,
          version: previous.version + 1,
          updatedBy: actor.uid,
          updatedAt: now,
        });
        if (nameKey !== previous.nameKey) {
          tx.delete(oldRef);
          tx.create(nextRef, { resourceId: id, kind, schemaVersion: 1 });
        }
        tx.set(this.repo.ref(tenantId, this.collection(kind), id), next);
        recordAudit(this.repo.foundation, tx, actor, tenantId, `${kind}.updated`, id, now, {
          fields: Object.keys(changes),
        });
        return output.parse(next);
      },
    );
  }
}
