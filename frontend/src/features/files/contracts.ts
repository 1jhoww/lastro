import { ApiError } from '@/api/errors';

export type Download = {
  bytes: ArrayBuffer;
  filename: string;
  mime: 'application/pdf' | 'text/csv';
  nextCursor: string | null;
  rowCount: number | null;
};
/** Janela aberta no toque (web), antes da espera, para o navegador não bloquear a abertura. */
export type Viewer = { show: (url: string) => boolean; close: () => void };
export type FilePresentation = {
  open: (viewer?: Viewer | null) => Promise<void>;
  save: () => Promise<void>;
  share: () => Promise<void>;
  dispose: () => void;
};

export function safeFilename(disposition: string | null, extension: 'pdf' | 'csv') {
  const name = disposition?.match(/(?:^|;)\s*filename="?([^";]+)"?/i)?.[1];
  return name &&
    /^[a-z0-9][a-z0-9._-]{0,150}$/i.test(name) &&
    name.toLowerCase().endsWith(`.${extension}`)
    ? name
    : `lastro.${extension}`;
}

/**
 * A mídia e assinatura são verificadas antes de criar qualquer URL ou arquivo local. Relatórios
 * completos informam limites próprios: CSV inteiro (sem paginação) de até 8 MiB.
 */
export async function readDownload(
  response: Response,
  mime: Download['mime'],
  limits: { maxBytes?: number; maxRows?: number | null } = {},
): Promise<Download> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'DOWNLOAD_ERROR',
      body?.error?.message ?? 'Não foi possível obter o arquivo',
      body?.error?.requestId,
    );
  }
  if (response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== mime)
    throw new ApiError(502, 'INVALID_DOWNLOAD', 'Resposta não contém o arquivo solicitado.');
  const maximum =
    limits.maxBytes ?? (mime === 'application/pdf' ? 8 * 1024 * 1024 : 1024 * 1024);
  const maxRows = limits.maxRows === undefined ? 100 : limits.maxRows;
  const length = Number(response.headers.get('Content-Length'));
  if (length > maximum)
    throw new ApiError(413, 'LOCAL_FILE_LIMIT', 'Arquivo acima do limite permitido.');
  const bytes = await response.arrayBuffer();
  const start = new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength));
  const valid =
    mime === 'application/pdf'
      ? String.fromCharCode(...start) === '%PDF-'
      : start[0] === 0xef && start[1] === 0xbb && start[2] === 0xbf;
  if (!valid || bytes.byteLength > maximum)
    throw new ApiError(
      502,
      'INVALID_DOWNLOAD',
      'Arquivo incompleto ou incompatível. Solicite novamente.',
    );
  const count = response.headers.get('X-Export-Row-Count');
  if (
    mime === 'text/csv' &&
    (count === null || !/^\d+$/.test(count) || (maxRows !== null && Number(count) > maxRows))
  )
    throw new ApiError(502, 'INVALID_DOWNLOAD', 'Metadados da página CSV ausentes ou inválidos.');
  return {
    bytes,
    mime,
    filename: safeFilename(
      response.headers.get('Content-Disposition'),
      mime === 'application/pdf' ? 'pdf' : 'csv',
    ),
    nextCursor: response.headers.get('X-Next-Cursor') || null,
    rowCount: count === null ? null : Number(count),
  };
}

export function downloadMessage(error: unknown) {
  if (!(error instanceof ApiError))
    return error instanceof Error ? error.message : 'Falha de rede. Solicite novamente.';
  const messages: Record<string, string> = {
    DOCUMENT_CHANGED: 'Pedido mudou durante a emissão. Atualize o pedido e solicite novamente.',
    DOCUMENT_BUSY: 'Emissão ocupada. Aguarde antes de tentar novamente.',
    EXPORT_BUSY: 'Exportação ocupada. Aguarde antes de tentar novamente.',
    RATE_LIMITED:
      'Limite de consultas ou downloads atingido. Aguarde o prazo informado antes de repetir.',
    READ_MEMORY_LIMIT:
      'Consulta excedeu o limite de leitura. Reduza o tamanho da página e reinicie.',
    DOCUMENT_UNSUPPORTED_TEXT:
      'Texto do pedido contém caracteres não suportados pelo PDF. Revise o cadastro com o administrador.',
  };
  if (error.status === 413)
    return 'Arquivo excedeu limite técnico. Reduza a página CSV; PDFs exigem revisão do pedido.';
  if (error.status === 401) return 'Sessão expirou. Entre novamente para obter o arquivo.';
  if (error.status === 403 || error.status === 404)
    return 'Arquivo indisponível para seu acesso atual.';
  return messages[error.code] ?? error.userMessage;
}
