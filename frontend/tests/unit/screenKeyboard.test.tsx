import { Platform, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Screen } from '@/layout/Screen';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

type Node = { props?: Record<string, unknown>; children?: unknown[] | null };
const dismissMode = (node: Node): unknown => {
  if (node.props?.keyboardDismissMode) return node.props.keyboardDismissMode;
  for (const child of node.children ?? []) {
    const found = typeof child === 'object' && child ? dismissMode(child as Node) : undefined;
    if (found) return found;
  }
  return undefined;
};
const rendered = async () => {
  await render(
    <Screen title="Tela">
      <Text>conteúdo</Text>
    </Screen>,
  );
  return dismissMode(screen.toJSON() as Node);
};

describe('teclado na tela padrão', () => {
  afterEach(() => jest.restoreAllMocks());

  it('na web, rolar não tira o foco do campo', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    expect(await rendered()).toBe('none');
  });

  it('no celular, arrastar continua fechando o teclado', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    expect(await rendered()).toBe('on-drag');
  });
});
