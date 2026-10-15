import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button } from '@/ui';

describe('Button', () => {
  it('bloqueia toques enquanto envia (proteção contra envio duplicado)', async () => {
    const onPress = jest.fn();
    await render(<Button label="Confirmar pedido" loading onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar pedido' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('dispara quando ativo', async () => {
    const onPress = jest.fn();
    await render(<Button label="Salvar" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
