import { describe, it, expect } from 'vitest';
import {
  decideMigration,
  type MigrationInput,
} from '../../src/modules/platformAdmin/planMigration.js';

const owner = { uid: 'owner', role: 'administrator' as const, status: 'active' as const };
const legacy = (change: Partial<MigrationInput> = {}): MigrationInput => ({
  subscription: {
    planCode: null,
    status: 'active',
    userLimit: 2,
    billingContact: null,
    monthlyPriceCents: 20000,
  },
  activeUsers: 2,
  activeAdmins: 1,
  reservedInvitations: 0,
  memberships: [
    { ...owner, seatExempt: false, platformAdmin: false },
    { uid: 'seller', role: 'seller', status: 'active', seatExempt: false, platformAdmin: false },
  ],
  ownerEmail: 'dono@example.invalid',
  ...change,
});

describe('Migração para os planos oficiais', () => {
  it('piloto com 2 usuários vai ao Profissional, mantém valor e aguarda ativação', () => {
    const decision = decideMigration(legacy());
    expect(decision.skipped).toBeNull();
    expect(decision.subscription).toEqual({
      planCode: 'profissional',
      planId: 'profissional',
      planVersion: 1,
      userLimit: 2,
      status: 'pending',
      billingDay: null,
      billingStartsOn: null,
      billingContact: { name: null, email: 'dono@example.invalid', phone: null },
    });
    expect(decision.subscription).not.toHaveProperty('monthlyPriceCents');
    expect(decision.warnings).toEqual([]);
  });
  it('mantém suspensa e o contato já cadastrado', () => {
    const contact = { name: 'Fin', email: null, phone: null };
    const decision = decideMigration(
      legacy({
        subscription: { ...legacy().subscription, status: 'suspended', billingContact: contact },
      }),
    );
    expect(decision.subscription).toMatchObject({ status: 'suspended', billingContact: contact });
  });
  it.each([
    ['cancelada', { status: 'canceled' as const }, 'canceled'],
    ['limite personalizado', { userLimit: 5 }, 'custom_user_limit'],
  ])('não migra assinatura %s', (_label, change, reason) => {
    const decision = decideMigration(
      legacy({ subscription: { ...legacy().subscription, ...change } }),
    );
    expect(decision).toMatchObject({ subscription: null, skipped: reason });
  });
  it('não migra quando convites pendentes ultrapassariam o Profissional', () => {
    expect(decideMigration(legacy({ reservedInvitations: 1 })).skipped).toBe('over_capacity');
  });
  it('já oficial não muda o contrato', () => {
    const decision = decideMigration(
      legacy({ subscription: { ...legacy().subscription, planCode: 'essencial', userLimit: 1 } }),
    );
    expect(decision).toMatchObject({ subscription: null, skipped: null });
  });
  it('Super Admin deixa de ocupar vaga quando a empresa tem administrador próprio', () => {
    const decision = decideMigration(
      legacy({
        activeUsers: 3,
        activeAdmins: 2,
        memberships: [
          ...legacy().memberships,
          {
            uid: 'hepta',
            role: 'administrator',
            status: 'active',
            seatExempt: false,
            platformAdmin: true,
          },
        ],
      }),
    );
    expect(decision.exemptUids).toEqual(['hepta']);
    expect(decision.counters).toEqual({ activeUsers: 2, activeAdmins: 1 });
    expect(decision.subscription?.planCode).toBe('profissional');
  });
  it('Super Admin como único administrador é mantido e reportado', () => {
    const decision = decideMigration(
      legacy({
        activeUsers: 1,
        activeAdmins: 1,
        memberships: [
          {
            uid: 'hepta',
            role: 'administrator',
            status: 'active',
            seatExempt: false,
            platformAdmin: true,
          },
        ],
      }),
    );
    expect(decision.exemptUids).toEqual([]);
    expect(decision.counters).toEqual({ activeUsers: 1, activeAdmins: 1 });
    expect(decision.warnings).toContain('super_admin_is_only_admin');
  });
  it('contador divergente é reportado sem correção automática', () => {
    expect(decideMigration(legacy({ activeUsers: 3 })).warnings).toContain('counter_mismatch');
  });
});
