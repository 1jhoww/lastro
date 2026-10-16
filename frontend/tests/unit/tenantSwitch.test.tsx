import { Pressable, Text } from 'react-native';
import { router, useRouter } from 'expo-router';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import Customers from '@/app/(app)/clientes/index';
import { useSession } from '@/session/SessionContext';
import { createFakeApi, customer, membership, ok, page } from '../support/fakeApi';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

/** Escolha de empresa mínima para o teste: seleciona e volta para clientes. */
function ChooseTenant() {
  const session = useSession();
  const r = useRouter();
  return (
    <>
      {['t1', 't2'].map((t) => (
        <Pressable
          key={t}
          accessibilityRole="button"
          onPress={() => {
            session.selectTenant(t);
            r.replace('/clientes');
          }}
        >
          <Text>{`usar ${t}`}</Text>
        </Pressable>
      ))}
    </>
  );
}

it('trocar de empresa não mostra clientes da empresa anterior', async () => {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
  });
  let releaseT2: () => void = () => {};
  const t2Ready = new Promise<void>((r) => (releaseT2 = r));
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () =>
      ok({
        uid: 'u1',
        email: 'ana@lastro.test',
        platformAdmin: false,
        memberships: [membership('t1'), membership('t2', 'seller')],
      }),
    )
    .on('GET', '/api/v1/users', () => ok({ items: [], nextCursor: null, pendingInvitations: [] }))
    .on('GET', '/api/v1/customers', async (c) => {
      if (c.headers['x-tenant-id'] === 't2') {
        // A empresa nova demora a responder: nada da anterior pode aparecer nesse intervalo.
        await t2Ready;
        return ok(page([customer('b1', { name: 'Cliente da Empresa B' })]));
      }
      return ok(page([customer('a1', { name: 'Cliente da Empresa A' })]));
    });

  await renderApp({
    gateway,
    fetch: server.fetch,
    overrides: { empresas: ChooseTenant, '(app)/clientes/index': Customers },
  });

  await fireEvent.press(await screen.findByText('usar t1'));
  expect(await screen.findByText('Cliente da Empresa A')).toBeTruthy();

  await act(async () => router.navigate('/empresas'));
  await fireEvent.press(await screen.findByText('usar t2'));

  // Enquanto a empresa B carrega, a lista da A já sumiu.
  await waitFor(() => expect(screen.queryByText('Cliente da Empresa A')).toBeNull());
  await act(async () => releaseT2());
  expect(await screen.findByText('Cliente da Empresa B')).toBeTruthy();
  expect(screen.queryByText('Cliente da Empresa A')).toBeNull();

  const last = server.calls.filter((c) => c.path === '/api/v1/customers').at(-1);
  expect(last?.headers['x-tenant-id']).toBe('t2');
  // Perfil da empresa B (vendedor): a tela já reflete as permissões novas.
  expect(screen.queryByLabelText(/Responsável/)).toBeNull();
});
