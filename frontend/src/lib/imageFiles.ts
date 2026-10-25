import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ApiError, toApiError, waitText } from '@/api/errors';
import { redrawImage } from './imageCanvas';

/**
 * Preparo de fotos para envio (produtos e logotipo). O servidor continua sendo a autoridade:
 * detecta o formato real, recusa o que não é JPEG/PNG/WebP e grava WebP. Aqui só se evita
 * enviar o que certamente seria recusado e se reduz o que é grande demais para a rede.
 */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
/** Foto escolhida: `type` é o que o aparelho declarou, que pode não ser o formato real. */
export type PickedImage = { uri: string; type: string; sizeBytes?: number };

const isImageType = (value: string | null | undefined): value is ImageType =>
  (IMAGE_TYPES as readonly string[]).includes(value ?? '');
/** No navegador, fotos acima disso são redesenhadas menores antes de subir. */
const REDRAW_ABOVE_BYTES = 2 * 1024 * 1024;

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function headBytes(dataUri: string): number[] {
  const data = dataUri.slice(dataUri.indexOf(',') + 1, dataUri.indexOf(',') + 17);
  const bytes: number[] = [];
  for (let i = 0; i + 3 < data.length; i += 4) {
    const n = [0, 1, 2, 3].reduce(
      (acc, k) => (acc << 6) | Math.max(0, BASE64.indexOf(data[i + k]!)),
      0,
    );
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  return bytes;
}
async function readHead(blob: Blob): Promise<number[]> {
  const head = blob.slice(0, 12);
  try {
    if (typeof head.arrayBuffer === 'function')
      return [...new Uint8Array(await head.arrayBuffer())];
  } catch {
    // Some React Native versions expose the method without implementing it.
  }
  // FileReader com data URI funciona igual no navegador e no React Native.
  if (typeof FileReader === 'undefined') return [];
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(headBytes(String(reader.result)));
    reader.onerror = () => resolve([]);
    reader.readAsDataURL(head);
  });
}

/** Formato real pela assinatura do arquivo (o nome ou o rótulo do aparelho podem mentir). */
export async function sniffImageType(blob: Blob): Promise<ImageType | null> {
  const b = await readHead(blob);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v))
    return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Bytes e Content-Type a enviar. Usa o formato real quando reconhecido; no navegador, redesenha
 * fotos grandes (até `maxEdge` px) e converte formatos que ele abre mas o servidor não aceita.
 * Falhas viram ApiError com o mesmo código que o servidor usaria.
 */
export async function prepareImage(
  image: PickedImage,
  maxEdge: number,
): Promise<{ body: Blob; type: ImageType }> {
  let blob: Blob;
  try {
    blob = await (await fetch(image.uri)).blob();
  } catch (e) {
    throw new ApiError(422, 'IMAGE_READ_FAILED', toApiError(e).message);
  }
  const sniffed = await sniffImageType(blob);
  if (!sniffed || blob.size > REDRAW_ABOVE_BYTES) {
    const redrawn = await redrawImage(blob, maxEdge, sniffed !== 'image/jpeg');
    if (redrawn && redrawn.size <= IMAGE_MAX_BYTES && (!sniffed || redrawn.size < blob.size)) {
      const type = (await sniffImageType(redrawn)) ?? redrawn.type;
      if (isImageType(type)) return { body: redrawn, type };
    }
  }
  const type = sniffed ?? (isImageType(image.type) ? image.type : null);
  if (!type) throw new ApiError(422, 'UNSUPPORTED_IMAGE_FORMAT', 'Formato não suportado');
  if (blob.size > IMAGE_MAX_BYTES)
    throw new ApiError(413, 'IMAGE_TOO_LARGE', 'Imagem acima de 5 MB');
  return { body: blob, type };
}

const typeFromUri = (uri: string): ImageType | null => {
  const m = /\.(jpe?g|png|webp)(?:\?|$)/i.exec(uri)?.[1]?.toLowerCase();
  if (!m) return null;
  return m === 'png' ? 'image/png' : m === 'webp' ? 'image/webp' : 'image/jpeg';
};

/**
 * Escolhe uma foto da galeria e confere antes de qualquer envio. No navegador a foto já sai
 * daqui preparada (formato real, reduzida, convertida se preciso), então um arquivo recusado
 * aparece na hora, antes de salvar o cadastro. No celular o seletor já comprime e o servidor
 * reduz; aqui só se recusam tipo declarado e tamanho fora do limite.
 */
export async function pickImageFile(
  maxEdge: number,
): Promise<PickedImage | { error: string } | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 0.85,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const declared = asset.mimeType ?? typeFromUri(asset.uri) ?? 'image/jpeg';
  if (Platform.OS !== 'web') {
    if (!isImageType(declared)) return { error: 'Use uma imagem JPEG, PNG ou WebP.' };
    if (asset.fileSize !== undefined && asset.fileSize > IMAGE_MAX_BYTES)
      return { error: 'A imagem tem mais de 5 MB. Escolha uma menor.' };
    return { uri: asset.uri, type: declared, sizeBytes: asset.fileSize };
  }
  try {
    const prepared = await prepareImage(
      { uri: asset.uri, type: declared, sizeBytes: asset.fileSize },
      maxEdge,
    );
    return {
      uri: URL.createObjectURL(prepared.body),
      type: prepared.type,
      sizeBytes: prepared.body.size,
    };
  } catch (e) {
    return { error: imageFailure(e).message };
  }
}

/** Motivo de uma falha de envio de imagem, em linguagem de quem cadastra, e se repetir ajuda. */
export function imageFailure(error: unknown): { message: string; retryable: boolean } {
  const err = toApiError(error);
  if (err.code === 'IMAGE_TOO_LARGE' || err.status === 413)
    return {
      message:
        'Arquivo muito grande: o limite é 5 MB. Reduza a foto (ou salve uma cópia menor) e envie de novo.',
      retryable: false,
    };
  if (err.code === 'UNSUPPORTED_IMAGE_FORMAT')
    return {
      message:
        'Formato incompatível. Use uma foto JPEG, PNG ou WebP; HEIC, GIF, PDF e SVG não são aceitos.',
      retryable: false,
    };
  if (err.code === 'IMAGE_RESOLUTION_LIMIT')
    return {
      message: 'Resolução acima de 50 megapixels. Reduza a foto e envie de novo.',
      retryable: false,
    };
  if (err.code === 'INVALID_IMAGE' || err.code === 'IMAGE_READ_FAILED')
    return {
      message:
        'Imagem inválida ou corrompida. Abra o arquivo, salve uma cópia em JPEG ou PNG e envie de novo.',
      retryable: false,
    };
  if (err.kind === 'rateLimited')
    return {
      message: `Limite de envios de imagens desta hora atingido. Tente de novo em ${waitText(err.retryAfterSeconds ?? 60)}.`,
      retryable: true,
    };
  if (err.kind === 'network')
    return {
      message:
        'Problema de conexão: a imagem não chegou ao servidor. Verifique a internet e tente de novo.',
      retryable: true,
    };
  if (err.kind === 'server')
    return {
      message:
        'Erro interno ao salvar a imagem. Tente de novo em instantes; se continuar, avise o suporte.',
      retryable: true,
    };
  if (err.code === 'CONFLICT')
    return {
      message: 'O registro mudou enquanto você enviava. A tela foi atualizada; envie de novo.',
      retryable: true,
    };
  return { message: err.userMessage, retryable: false };
}
