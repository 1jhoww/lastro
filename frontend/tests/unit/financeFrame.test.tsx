import { useEffect } from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { FinanceFrame } from '@/features/finance/FinanceNav';

let mockWidth = 390;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 900, scale: 1, fontScale: 1 }),
}));
jest.mock('@/session/SessionContext', () => ({
  useSession: () => ({
    role: 'administrator',
    isPlatformAdmin: false,
    permissions: ['receivables:read'],
  }),
}));
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: unknown }) => children,
  router: { navigate: jest.fn() },
  usePathname: () => '/financeiro',
}));

describe('área do Financeiro', () => {
  it('mudar a largura da janela não recria a tela aberta', async () => {
    let mounts = 0;
    const Open = () => {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <Text>tela aberta</Text>;
    };
    const tree = () => (
      <FinanceFrame>
        <Open />
      </FinanceFrame>
    );
    const view = await render(tree());
    expect(screen.queryByRole('link', { name: 'Visão geral' })).toBeNull();
    mockWidth = 1440;
    await view.rerender(tree());
    expect(screen.getByRole('link', { name: 'Visão geral' })).toBeTruthy();
    mockWidth = 390;
    await view.rerender(tree());
    expect(screen.queryByRole('link', { name: 'Visão geral' })).toBeNull();
    expect(screen.getByText('tela aberta')).toBeTruthy();
    expect(mounts).toBe(1);
  });
});
