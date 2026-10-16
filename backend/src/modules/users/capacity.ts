import type { QuerySnapshot } from 'firebase-admin/firestore';
import { invitationSchema, type Invitation } from '../../shared/schemas/models.js';

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
