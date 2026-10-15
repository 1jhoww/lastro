import type { Download } from '@/features/files/contracts';
import { resetPrivateFiles } from '@/features/files/fileEpoch';
import { clearOrphanFiles, stageFile } from '@/features/files/presentation.native';
import * as Sharing from 'expo-sharing';
jest.mock('expo-file-system', () => {
  const files = new Map<string, Uint8Array>();
  const folders = new Set<string>();
  const uri = (parts: unknown[]) =>
    parts
      .map((part) => (typeof part === 'string' ? part : (part as { uri: string }).uri))
      .join('/');
  return {
    Paths: { cache: 'file://cache' },
    _files: files,
    _folders: folders,
    Directory: class {
      uri: string;
      constructor(...parts: unknown[]) {
        this.uri = uri(parts);
      }
      get exists() {
        return folders.has(this.uri);
      }
      create() {
        folders.add(this.uri);
      }
      delete() {
        for (const key of files.keys()) if (key.startsWith(this.uri + '/')) files.delete(key);
        for (const key of folders) if (key.startsWith(this.uri)) folders.delete(key);
      }
    },
    File: class {
      uri: string;
      constructor(...parts: unknown[]) {
        this.uri = uri(parts);
      }
      get exists() {
        return files.has(this.uri);
      }
      write(bytes: Uint8Array) {
        files.set(this.uri, bytes);
      }
      delete() {
        files.delete(this.uri);
      }
    },
  };
});
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));
const download: Download = {
  bytes: new TextEncoder().encode('%PDF-native').buffer,
  filename: 'pedido-servidor.pdf',
  mime: 'application/pdf',
  rowCount: null,
  nextCursor: null,
};
beforeEach(() => {
  jest.clearAllMocks();
  clearOrphanFiles();
  resetPrivateFiles();
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
});
it('grava bytes autenticados no cache privado e compartilha URI local com nome do servidor', async () => {
  const file = stageFile(download);
  await file.share();
  const [uri, options] = jest.mocked(Sharing.shareAsync).mock.calls[0]!;
  expect(uri).toMatch(/^file:\/\/cache\/lastro-private-documents\/.+\/pedido-servidor.pdf$/);
  expect(options).toMatchObject({ mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  expect(jest.requireMock('expo-file-system')._files.get(uri)).toEqual(
    new Uint8Array(download.bytes),
  );
  file.dispose();
  expect(jest.requireMock('expo-file-system')._files.size).toBe(0);
});
it('ausência de aplicativo não tenta enviar endpoint privado', async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
  await expect(stageFile(download).open()).rejects.toThrow('Nenhum aplicativo');
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});
it('troca de sessão durante disponibilidade descarta compartilhamento e limpa temporário', async () => {
  let release: (value: boolean) => void = () => {};
  jest.mocked(Sharing.isAvailableAsync).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const file = stageFile(download),
    sharing = file.share();
  resetPrivateFiles();
  release(true);
  await expect(sharing).rejects.toThrow('Sessão ou empresa mudou');
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(jest.requireMock('expo-file-system')._files.size).toBe(0);
});
it('CSV nativo conserva BOM e oferece salvar pelo seletor do sistema', async () => {
  const csv: Download = {
    ...download,
    bytes: new TextEncoder().encode('\ufeff"nome"\r\n').buffer,
    filename: 'clientes.csv',
    mime: 'text/csv',
    rowCount: 0,
  };
  await stageFile(csv).save();
  expect(Sharing.shareAsync).toHaveBeenCalledWith(
    expect.stringContaining('clientes.csv'),
    expect.objectContaining({ mimeType: 'text/csv' }),
  );
});
it('limpeza inicial remove apenas diretório próprio', () => {
  const fs = jest.requireMock('expo-file-system');
  fs._files.set('file://cache/outro-app.pdf', new Uint8Array([1]));
  stageFile(download);
  clearOrphanFiles();
  expect([...fs._files.keys()]).toEqual(['file://cache/outro-app.pdf']);
  fs._files.clear();
});
