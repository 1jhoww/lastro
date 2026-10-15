import { requireCondition } from '../../shared/errors/appError.js';
// Published Firestore storage-size formula, for the JSON scalar/map/array model used here.
// This is document storage size, not commit protobuf or index size.
export const FIRESTORE_DOCUMENT_BYTES = 1_048_576;
const stringSize = (v: string) => Buffer.byteLength(v, 'utf8') + 1;
export function valueSize(value: unknown): number {
  if (value === null || typeof value === 'boolean') return 1;
  if (typeof value === 'number') return 8;
  if (typeof value === 'string') return stringSize(value);
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + valueSize(item), 0);
  requireCondition(
    value && typeof value === 'object',
    500,
    'INTERNAL_ERROR',
    'Erro interno do servidor',
  );
  return (
    32 +
    Object.entries(value).reduce((sum, [key, item]) => sum + stringSize(key) + valueSize(item), 0)
  );
}
export const documentSize = (path: string, document: Record<string, unknown>) =>
  16 + path.split('/').reduce((sum, part) => sum + stringSize(part), 0) + valueSize(document);
export function assertDocumentFits(path: string, document: Record<string, unknown>) {
  requireCondition(
    documentSize(path, document) <= FIRESTORE_DOCUMENT_BYTES,
    413,
    'ORDER_TECHNICAL_LIMIT',
    'Pedido excede o tamanho técnico de documento; operação não aplicada',
  );
}
