import { ApiError } from '@/api/errors';
import { authErrorMessage, isNetworkFailure, isSessionLost } from '@/auth/authErrors';
import { inviteFailure } from '@/features/invitations/inviteErrors';

describe('mensagens do Firebase', () => {
  it('credencial errada não revela se o e-mail existe', () => {
    const a = authErrorMessage({ code: 'auth/user-not-found' });
    const b = authErrorMessage({ code: 'auth/wrong-password' });
    const c = authErrorMessage({ code: 'auth/invalid-credential' });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('classifica sessão perdida e rede', () => {
    expect(isSessionLost({ code: 'auth/user-token-expired' })).toBe(true);
    expect(isSessionLost({ code: 'auth/network-request-failed' })).toBe(false);
    expect(isNetworkFailure({ code: 'auth/network-request-failed' })).toBe(true);
    expect(authErrorMessage(new Error('x'))).toMatch(/Tente de novo/);
  });
});

describe('falhas de convite', () => {
  const e = (status: number, code: string) => new ApiError(status, code, code);

  it.each([
    [410, 'INVITATION_EXPIRED', /venceu/],
    [403, 'INVITATION_INVALID', /já foi usado, foi revogado/],
    [409, 'USER_LIMIT_REACHED', /limite de usuários/],
    [409, 'LAST_ADMIN_REQUIRED', /configuração/],
    [403, 'SUBSCRIPTION_SUSPENDED', /indisponível/],
    [403, 'FORBIDDEN', /desativada/],
  ])('%i %s', (status, code, pattern) => {
    const f = inviteFailure(e(status, code), 'ana@lastro.test');
    expect(`${f.title} ${f.body}`).toMatch(pattern);
  });

  it('convite para outro e-mail mostra a conta em uso', () => {
    expect(inviteFailure(e(403, 'INVITATION_INVALID'), 'ana@lastro.test').body).toContain(
      'ana@lastro.test',
    );
  });

  it('já membro oferece entrar, sem repetir', () => {
    const f = inviteFailure(e(409, 'CONFLICT'), null);
    expect(f.alreadyMember).toBe(true);
    expect(f.retry).toBeUndefined();
  });

  it('rede permite tentar de novo', () => {
    expect(inviteFailure(e(0, 'NETWORK_ERROR'), null).retry).toBe(true);
  });
});
