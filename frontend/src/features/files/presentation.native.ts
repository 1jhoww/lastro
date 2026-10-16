import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import type { Download, FilePresentation, Viewer } from './contracts';
import { fileLease, trackPrivateFile } from './fileEpoch';

const directory = () => new Directory(Paths.cache, 'lastro-private-documents');
let initialized = false;
export function clearOrphanFiles() {
  const folder = directory();
  if (folder.exists) folder.delete();
  initialized = true;
}
/** Nativo abre pela folha do sistema; não há aba a reservar. */
export function reserveViewer(): Viewer | null {
  return null;
}
export function stageFile(download: Download): FilePresentation {
  if (!initialized) clearOrphanFiles();
  const check = fileLease();
  const folder = directory();
  folder.create({ idempotent: true, intermediates: true });
  const slot = new Directory(folder, randomUUID());
  slot.create();
  const file = new File(slot, download.filename);
  const dispose = trackPrivateFile(() => {
    if (slot.exists) slot.delete();
  });
  try {
    file.write(new Uint8Array(download.bytes));
  } catch (error) {
    dispose();
    throw error;
  }
  const share = async () => {
    check();
    const available = await Sharing.isAvailableAsync();
    check();
    if (!available)
      throw new Error('Nenhum aplicativo disponível para abrir ou salvar este arquivo.');
    await Sharing.shareAsync(file.uri, {
      mimeType: download.mime,
      UTI:
        download.mime === 'application/pdf'
          ? 'com.adobe.pdf'
          : 'public.comma-separated-values-text',
      dialogTitle: download.filename,
    });
  };
  return { dispose, open: share, save: share, share };
}
