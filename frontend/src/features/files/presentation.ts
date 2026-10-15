import type { Download, FilePresentation } from './contracts';
import { fileLease, trackPrivateFile } from './fileEpoch';

/** Web: URLs temporárias locais, sem token, endpoint privado ou upload público. */
export function stageFile(download: Download): FilePresentation {
  const check = fileLease();
  const blob = new Blob([download.bytes], { type: download.mime });
  const url = URL.createObjectURL(blob);
  const dispose = trackPrivateFile(() => URL.revokeObjectURL(url));
  return {
    dispose,
    async open() {
      check();
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      // Alguns navegadores retornam null mesmo com noopener; o download continua disponível.
      opened?.focus();
    },
    async save() {
      check();
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = download.filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
    async share() {
      check();
      const file = new File([blob], download.filename, { type: download.mime });
      if (!navigator.canShare?.({ files: [file] }) || !navigator.share)
        throw new Error(
          'Compartilhamento de arquivos indisponível neste navegador. Baixe o arquivo e anexe manualmente.',
        );
      await navigator.share({ files: [file] });
    },
  };
}
export function clearOrphanFiles() {
  /* Web não persiste os bytes ou URLs entre inicializações. */
}
