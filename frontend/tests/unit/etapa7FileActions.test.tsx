import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { FileActions } from '@/features/files/FileActions';
import { stageFile } from '@/features/files/presentation';
import { resetPrivateFiles } from '@/features/files/fileEpoch';
import type { Download } from '@/features/files/contracts';
import { ApiError, retryAfterSeconds } from '@/api/errors';
jest.mock('@/features/files/presentation', () => ({
  stageFile: jest.fn(() => ({
    open: jest.fn(),
    save: jest.fn(),
    share: jest.fn(),
    dispose: jest.fn(),
  })),
}));
const file: Download = {
  bytes: new TextEncoder().encode('%PDF-1.7').buffer,
  mime: 'application/pdf',
  filename: 'pedido.pdf',
  nextCursor: null,
  rowCount: null,
};
beforeEach(() => {
  jest.clearAllMocks();
  resetPrivateFiles();
});
afterEach(() => jest.useRealTimers());
it('Retry-After bloqueia nova solicitação e nunca faz retry automático', async () => {
  jest.useFakeTimers();
  const load = jest.fn(async () => {
    throw new ApiError(429, 'RATE_LIMITED', 'Aguarde', undefined, 3);
  });
  await render(<FileActions label="Obter PDF" load={load} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Obter PDF' }));
  expect(screen.getByText('Aguarde 3 segundos antes de solicitar outro arquivo.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Obter PDF' }).props.accessibilityState.disabled).toBe(
    true,
  );
  await act(async () => jest.advanceTimersByTime(3100));
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Obter PDF' }).props.accessibilityState.disabled).toBe(
    false,
  );
});
it('sessão trocada antes da resposta não cria apresentação de arquivo', async () => {
  const load = jest.fn(async () => {
    resetPrivateFiles();
    return file;
  });
  await render(<FileActions label="Obter PDF" load={load} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Obter PDF' }));
  expect(stageFile).not.toHaveBeenCalled();
  expect(screen.getByText('Sessão ou empresa mudou. Solicite o arquivo novamente.')).toBeTruthy();
});
it('desmontar tela libera apresentação e bytes temporários', async () => {
  const view = await render(<FileActions label="Obter PDF" load={async () => file} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Obter PDF' }));
  const presentation = jest.mocked(stageFile).mock.results[0]!.value;
  await view.unmount();
  expect(presentation.dispose).toHaveBeenCalledTimes(1);
});
it('interpreta Retry-After numérico, HTTP-date e valores inválidos', () => {
  expect(retryAfterSeconds(new Response('', { headers: { 'Retry-After': '60' } }))).toBe(60);
  expect(
    retryAfterSeconds(
      new Response('', { headers: { 'Retry-After': new Date(Date.now() + 60000).toUTCString() } }),
    ),
  ).toBeGreaterThanOrEqual(59);
  expect(
    retryAfterSeconds(new Response('', { headers: { 'Retry-After': 'invalid' } })),
  ).toBeUndefined();
});
