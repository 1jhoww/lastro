import type { Download, FilePresentation, Viewer } from './contracts';
import { fileLease, trackPrivateFile } from './fileEpoch';

/** Web: URLs temporárias locais, sem token, endpoint privado ou upload público. */
export function stageFile(download: Download): FilePresentation {
  const check = fileLease();
  const blob = new Blob([download.bytes], { type: download.mime });
  const url = URL.createObjectURL(blob);
  const dispose = trackPrivateFile(() => URL.revokeObjectURL(url));
  return {
    dispose,
    async open(viewer) {
      check();
      if (viewer?.show(url)) return;
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
/**
 * Abre a aba ainda dentro do toque e só depois recebe o PDF. Sem `opener`: a aba não alcança o
 * Lastro. Retorna null quando o navegador bloqueia; nesse caso a abertura direta é tentada.
 */
export function reserveViewer(waiting = 'Gerando PDF…'): Viewer | null {
  const tab = window.open('', '_blank');
  if (!tab) return null;
  try {
    tab.opener = null;
    tab.document.title = waiting;
    tab.document.body.style.font = '15px system-ui, sans-serif';
    tab.document.body.textContent = waiting;
  } catch {
    /* Página em branco sem acesso ao documento: segue só com a navegação. */
  }
  return {
    show(url) {
      if (tab.closed) return false;
      tab.location.href = url;
      return true;
    },
    close() {
      if (!tab.closed) tab.close();
    },
  };
}
export function clearOrphanFiles() {
  /* Web não persiste os bytes ou URLs entre inicializações. */
}
