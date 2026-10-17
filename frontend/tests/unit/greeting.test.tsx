import { act, screen } from 'expo-router/testing-library';
import Home from '@/app/(app)/index';
import { DAILY_PHRASES, msUntilNextDay, phraseFor } from '@/features/home/dailyPhrase';
import { firstNameOf } from '@/features/session/profile';
import { createFakeApi, membership, ok, page, tenant } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

describe('frase do dia', () => {
  it('percorre as dez frases em sequência pela data local e reinicia o ciclo', () => {
    const start = new Date(2026, 9, 16, 9, 0);
    const seen = Array.from({ length: 11 }, (_, i) => phraseFor(new Date(2026, 9, 16 + i, 9, 0)));
    expect(new Set(seen.slice(0, 10)).size).toBe(10);
    expect(seen[10]).toBe(seen[0]);
    const index = DAILY_PHRASES.indexOf(phraseFor(start) as (typeof DAILY_PHRASES)[number]);
    expect(seen[1]).toBe(DAILY_PHRASES[(index + 1) % 10]);
  });
  it('mantém a mesma frase durante todo o dia local', () => {
    expect(phraseFor(new Date(2026, 9, 16, 0, 0, 1))).toBe(
      phraseFor(new Date(2026, 9, 16, 23, 59, 59)),
    );
    expect(msUntilNextDay(new Date(2026, 9, 16, 23, 59, 0))).toBe(60_000);
  });
});

describe('primeiro nome', () => {
  it('usa só o primeiro nome, preserva acentos e nunca usa e-mail', () => {
    expect(firstNameOf('João Henrique')).toBe('João');
    expect(firstNameOf('  Ana   Carolina ')).toBe('Ana');
    expect(firstNameOf('Ágata')).toBe('Ágata');
    expect(firstNameOf('ana@empresa.com')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf('')).toBeNull();
  });
});

function world(name: string | null) {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
  });
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () =>
      ok({
        uid: 'u1',
        email: 'ana@lastro.test',
        name,
        platformAdmin: false,
        memberships: [membership('t1', 'seller')],
      }),
    )
    .on('GET', '/api/v1/tenants/current', () => ok(tenant('t1', 'Distribuidora Sol')))
    .on('GET', '/api/v1/orders', () => ok(page([])));
  return { gateway, server };
}

describe('saudação do painel', () => {
  afterEach(() => jest.useRealTimers());
  it('cumprimenta pelo primeiro nome cadastrado e mostra a frase do dia', async () => {
    const { gateway, server } = world('Ana Carolina');
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/',
      overrides: { '(app)/index': Home },
    });
    expect(await screen.findByText('Olá, Ana!')).toBeTruthy();
    expect(screen.getByText(phraseFor(new Date()))).toBeTruthy();
    expect(screen.queryByText(/Distribuidora Sol!/)).toBeNull();
  });
  it('sem nome cadastrado usa "Olá!" e não o e-mail', async () => {
    const { gateway, server } = world(null);
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/',
      overrides: { '(app)/index': Home },
    });
    expect(await screen.findByText('Olá!')).toBeTruthy();
    expect(screen.queryByText(/Olá, ana/)).toBeNull();
    await act(async () => {});
  });
});
