import type { Firestore, QuerySnapshot, Transaction } from 'firebase-admin/firestore';
import { invitationSchema, type Invitation } from '../../shared/schemas/models.js';
import { AppError } from '../../shared/errors/appError.js';

/**
 * Pending invitations read by the caller (status pending and not expired). Invitations
 * addressed to a Super Admin are excluded from seat reservation.
 */
export function pendingInvitations(snapshot: QuerySnapshot): Invitation[] {
  return snapshot.docs.map((doc) => invitationSchema.parse(doc.data()));
}

/** Seats reserved by pending invitations. */
export function reservedSeats(invitations: readonly Invitation[]): number {
  return invitations.filter((invitation) => !invitation.seatExempt).length;
}

/**
 * Valid pending invitations of a company, read inside the caller's transaction. Revoked,
 * accepted and expired invitations never reserve a seat. Every admission command also writes
 * the tenant document, so concurrent admissions on one company are serialized by Firestore.
 */
export async function validPendingInvitations(
  db: Firestore,
  tx: Transaction,
  tenantId: string,
  now: string,
): Promise<Invitation[]> {
  return pendingInvitations(
    await tx.get(
      db
        .collection(`tenants/${tenantId}/invitations`)
        .where('status', '==', 'pending')
        .where('expiresAt', '>', now)
        .limit(101),
    ),
  );
}

/** Occupied seats: active counted users plus valid pending invitations that reserve a seat. */
export function occupiedSeats(activeUsers: number, pending: readonly Invitation[]): number {
  return activeUsers + reservedSeats(pending);
}

/** Refusal shown when every contracted access is taken (or the company is above its limit). */
export function userLimitReached(userLimit: number): AppError {
  return new AppError(
    409,
    'USER_LIMIT_REACHED',
    `Seu plano permite até ${userLimit} ${userLimit === 1 ? 'usuário' : 'usuários'}. Todos os acessos estão ocupados.`,
  );
}
