import type { Auth } from 'firebase-admin/auth';
import { FoundationRepository } from '../../infrastructure/repositories/foundationRepository.js';
import { AccessService } from '../auth/accessService.js';
import type { Actor } from '../../shared/types/context.js';
import { AppError, requireCondition } from '../../shared/errors/appError.js';
import {
  emailChangeSchema,
  membershipSchema,
  tenantSchema,
  type EmailChange,
} from '../../shared/schemas/models.js';
import { emailChangeView } from '../../shared/schemas/http.js';
import { recordPlatformAudit } from '../../shared/audit/audit.js';

/** Days the holder has to confirm the new address. */
const EMAIL_CHANGE_DAYS = 7;

/**
 * E-mail change of an active account. Lastro identities, memberships and commercial history
 * are keyed by the provider uid, never by the address, so the person keeps everything.
 *
 * The Super Admin starts (or cancels) a request; it never changes the address itself. The
 * holder, signed in to the current account, re-authenticates and asks the identity provider
 * to verify the new address (Firebase `verifyBeforeUpdateEmail`): the provider only switches
 * the address after the link sent to it is opened. Then the request is marked completed. This
 * keeps one identity, never hands an account to whoever controls a mistyped address and
 * keeps Firebase Authentication as the single source of the address.
 */
export class EmailChangeService {
  constructor(
    readonly repo: FoundationRepository,
    readonly access: AccessService,
    readonly auth: Auth,
    readonly clock: () => Date = () => new Date(),
  ) {}

  private ref(uid: string) {
    return this.repo.global('emailChanges', uid);
  }

  view(change: EmailChange) {
    return emailChangeView.parse({
      ...change,
      expired: change.status === 'pending' && change.expiresAt <= this.clock().toISOString(),
    });
  }

  private pending(change: EmailChange | null): change is EmailChange {
    return change?.status === 'pending' && change.expiresAt > this.clock().toISOString();
  }

  /** Provider account of the holder; refuses unknown or disabled accounts. */
  private async account(uid: string) {
    try {
      return await this.auth.getUser(uid);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (code === 'auth/user-not-found')
        throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
      throw error;
    }
  }

  private async addressInUse(email: string): Promise<boolean> {
    try {
      await this.auth.getUserByEmail(email);
      return true;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (code === 'auth/user-not-found') return false;
      throw error;
    }
  }

  /** Super Admin: asks the holder of an access of this company to move to a new address. */
  async start(actor: Actor, tenantId: string, uid: string, newEmail: string, reason: string) {
    const account = await this.account(uid);
    const currentEmail = account.email?.trim().toLowerCase() ?? null;
    requireCondition(
      newEmail !== currentEmail,
      422,
      'VALIDATION_ERROR',
      'O novo e-mail é igual ao atual',
    );
    // One identity per address: never create a second one or take over another account.
    requireCondition(
      !(await this.addressInUse(newEmail)),
      409,
      'EMAIL_IN_USE',
      'Este e-mail já pertence a outra conta',
    );
    const now = this.clock();
    const at = now.toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const [tenant, member, previous, holderIsPlatformAdmin] = await Promise.all([
        this.repo.read(this.repo.global('tenants', tenantId), tenantSchema, tx),
        this.repo.read(this.repo.tenant(tenantId, 'memberships', uid), membershipSchema, tx),
        this.repo.read(this.ref(uid), emailChangeSchema, tx),
        this.access.isPlatformAdmin(uid, tx),
      ]);
      requireCondition(
        tenant && member?.tenantId === tenantId && member.uid === uid && !member.seatExempt,
        404,
        'RESOURCE_NOT_FOUND',
        'Recurso não encontrado',
      );
      // Platform accounts are administered outside company access management.
      requireCondition(
        !holderIsPlatformAdmin,
        403,
        'PLATFORM_ACCOUNT_PROTECTED',
        'Contas do Super Admin não são alteradas por este fluxo',
      );
      requireCondition(
        !this.pending(previous),
        409,
        'CONFLICT',
        'Já existe alteração de e-mail pendente para esta conta',
      );
      const change = emailChangeSchema.parse({
        uid,
        tenantId,
        currentEmail,
        newEmail,
        status: 'pending',
        reason,
        requestedBy: actor.uid,
        expiresAt: new Date(now.getTime() + EMAIL_CHANGE_DAYS * 86400000).toISOString(),
        completedAt: null,
        createdAt: at,
        updatedAt: at,
        schemaVersion: 1,
      });
      tx.set(this.ref(uid), change);
      recordPlatformAudit(
        this.repo,
        tx,
        actor,
        tenantId,
        'account.email_change.requested',
        uid,
        at,
        {
          previousEmail: currentEmail,
          newEmail,
          reason,
        },
      );
      return this.view(change);
    });
  }

  /** Super Admin: cancels a request the holder has not completed. */
  async cancel(actor: Actor, tenantId: string, uid: string, reason: string) {
    const at = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      await this.access.platform(actor, tx);
      const change = await this.repo.read(this.ref(uid), emailChangeSchema, tx);
      requireCondition(
        change?.tenantId === tenantId && change.uid === uid,
        404,
        'RESOURCE_NOT_FOUND',
        'Recurso não encontrado',
      );
      requireCondition(change.status === 'pending', 409, 'CONFLICT', 'Alteração já encerrada');
      const next = emailChangeSchema.parse({ ...change, status: 'canceled', updatedAt: at });
      tx.set(this.ref(uid), next);
      recordPlatformAudit(
        this.repo,
        tx,
        actor,
        tenantId,
        'account.email_change.canceled',
        uid,
        at,
        {
          newEmail: change.newEmail,
          reason,
        },
      );
      return this.view(next);
    });
  }

  /** Holder: own pending request, if any. */
  async mine(actor: Actor) {
    const change = await this.repo.read(this.ref(actor.uid), emailChangeSchema);
    return { emailChange: change && this.pending(change) ? this.view(change) : null };
  }

  /**
   * Holder: records that the provider applied the new, verified address. Fresh provider data
   * is the proof; a request alone never changes anything.
   */
  async complete(actor: Actor) {
    const account = await this.account(actor.uid);
    const at = this.clock().toISOString();
    return this.repo.db.runTransaction(async (tx) => {
      const change = await this.repo.read(this.ref(actor.uid), emailChangeSchema, tx);
      requireCondition(
        change?.uid === actor.uid && change.status === 'pending',
        404,
        'RESOURCE_NOT_FOUND',
        'Nenhuma alteração de e-mail pendente',
      );
      requireCondition(
        !account.disabled &&
          account.emailVerified &&
          account.email?.trim().toLowerCase() === change.newEmail,
        409,
        'EMAIL_CHANGE_NOT_CONFIRMED',
        'O novo e-mail ainda não foi confirmado',
      );
      const next = emailChangeSchema.parse({
        ...change,
        status: 'completed',
        completedAt: at,
        updatedAt: at,
      });
      tx.set(this.ref(actor.uid), next);
      recordPlatformAudit(
        this.repo,
        tx,
        actor,
        change.tenantId,
        'account.email_change.completed',
        actor.uid,
        at,
        { previousEmail: change.currentEmail, newEmail: change.newEmail },
      );
      return { emailChange: this.view(next) };
    });
  }

  /** Pending requests of a company's members, with whether the provider already applied them. */
  async forMembers(uids: string[], providerEmails: Map<string, string | null>) {
    const result = new Map<
      string,
      ReturnType<EmailChangeService['view']> & { appliedByProvider: boolean }
    >();
    const docs = uids.length ? await this.repo.db.getAll(...uids.map((uid) => this.ref(uid))) : [];
    for (const doc of docs) {
      if (!doc.exists) continue;
      const change = emailChangeSchema.parse(doc.data());
      if (change.status !== 'pending') continue;
      result.set(change.uid, {
        ...this.view(change),
        appliedByProvider: providerEmails.get(change.uid) === change.newEmail,
      });
    }
    return result;
  }
}
