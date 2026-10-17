import { allowedRoots, homeFor, resolveGate, type GateInput } from '@/session/gate';
import { membership } from '../support/fakeApi';

const me = (memberships: ReturnType<typeof membership>[], platformAdmin = false) => ({
  uid: 'u1',
  email: 'ana@lastro.test',
  name: 'Ana Carolina',
  platformAdmin,
  memberships,
});

const base: GateInput = {
  auth: 'signedIn',
  me: undefined,
  meFailed: false,
  preferenceLoading: false,
  selectedTenantId: null,
};

describe('resolveGate', () => {
  it('não decide nada antes de o provedor e o /me responderem', () => {
    expect(resolveGate({ ...base, auth: 'initializing' }).kind).toBe('boot');
    expect(resolveGate(base).kind).toBe('boot');
    expect(resolveGate({ ...base, me: me([membership('t1')]), preferenceLoading: true }).kind).toBe(
      'boot',
    );
  });

  it('sem sessão vai para entrar', () => {
    const g = resolveGate({ ...base, auth: 'signedOut' });
    expect(g.kind).toBe('signedOut');
    expect(homeFor(g)).toBe('/entrar');
    expect(allowedRoots(g)).toEqual(['(auth)', 'convite']);
  });

  it('falha do /me vira tela de erro, sem rotas montadas', () => {
    const g = resolveGate({ ...base, meFailed: true });
    expect(g.kind).toBe('meError');
    expect(allowedRoots(g)).toEqual([]);
  });

  it('uma empresa só: entra direto', () => {
    const g = resolveGate({ ...base, me: me([membership('t1')]) });
    expect(g).toMatchObject({ kind: 'tenant', membership: { tenantId: 't1' } });
    expect(homeFor(g)).toBe('/');
  });

  it('várias empresas sem escolha: pede escolha', () => {
    const g = resolveGate({ ...base, me: me([membership('t1'), membership('t2', 'seller')]) });
    expect(g.kind).toBe('chooseTenant');
    expect(allowedRoots(g)).not.toContain('(app)');
  });

  it('escolha salva que não existe mais em /me é ignorada (sem confiar no cliente)', () => {
    const g = resolveGate({
      ...base,
      me: me([membership('t1'), membership('t2')]),
      selectedTenantId: 'outra-empresa',
    });
    expect(g.kind).toBe('chooseTenant');
  });

  it('assinatura suspensa ou cancelada bloqueia a área da empresa', () => {
    for (const access of ['suspended', 'canceled', 'provisioning'] as const) {
      const g = resolveGate({ ...base, me: me([membership('t1', 'administrator', access)]) });
      expect(g.kind).toBe('tenantBlocked');
      expect(allowedRoots(g)).not.toContain('(app)');
      expect(homeFor(g)).toBe('/acesso-bloqueado');
    }
  });

  it('past_due chega como allowed e mantém o acesso', () => {
    const g = resolveGate({ ...base, me: me([membership('t1', 'seller', 'allowed')]) });
    expect(g.kind).toBe('tenant');
  });

  it('Super Admin sem empresa vai para a plataforma; usuário comum para sem-empresa', () => {
    expect(homeFor(resolveGate({ ...base, me: me([], true) }))).toBe('/plataforma');
    expect(homeFor(resolveGate({ ...base, me: me([], false) }))).toBe('/sem-empresa');
    expect(allowedRoots(resolveGate({ ...base, me: me([], false) }))).not.toContain('plataforma');
  });

  it('plataforma só aparece para Super Admin, mesmo dentro de uma empresa', () => {
    const admin = resolveGate({ ...base, me: me([membership('t1')], true) });
    const seller = resolveGate({ ...base, me: me([membership('t1', 'seller')], false) });
    expect(allowedRoots(admin)).toContain('plataforma');
    expect(allowedRoots(seller)).not.toContain('plataforma');
  });
});
