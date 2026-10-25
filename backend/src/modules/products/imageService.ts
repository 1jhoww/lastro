import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import type { Firebase } from '../../infrastructure/firebase/client.js';
import type { ProductService } from './productService.js';
import type { Actor } from '../../shared/types/context.js';
import { AppError, requireCondition } from '../../shared/errors/appError.js';
import { productSchema, imageView } from '../../shared/schemas/commercial.js';
import { Timestamp } from 'firebase-admin/firestore';
import { opaqueId } from '../../shared/schemas/models.js';
import { recordAudit } from '../../shared/audit/audit.js';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/**
 * Decoded pixel budget. It covers 48–50 MP phone photos; the header is checked before any
 * pixel is decoded, so larger inputs (decompression bombs included) never reach the decoder.
 */
export const MAX_IMAGE_PIXELS = 50_000_000;
export const MAX_IMAGE_SIDE = 12_000;
/** Longest edge kept for catalog photos: sharp on screen and in PDFs, a fraction of the bytes. */
export const PRODUCT_IMAGE_EDGE = 2048;
/** Pixel side of PDF thumbnails: 15 mm printed at about 270 dpi. */
export const PDF_THUMBNAIL_PX = 160;
/** Upper bound of photos fetched for one document (orders hold far fewer distinct products). */
const PDF_THUMBNAIL_LIMIT = 200;
type ImageFormat = 'jpeg' | 'png' | 'webp';
/** Declared types accepted as a hint; the signature below decides the real format. */
const acceptedTypes = new Set([
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'application/octet-stream',
]);
/**
 * Real format from the file signature. Browsers label files by extension, so a `.jpg` that is
 * really WebP (common in supplier catalogs) arrives as image/jpeg; the decoder only ever runs
 * for these three signatures.
 */
export function sniffImage(data: Buffer): ImageFormat | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'png';
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'webp';
  return null;
}
/**
 * At most two decodes per instance: a 50 MP PNG takes about 200 MB while decoding and the API
 * runs on 1 GiB instances. Others wait their turn instead of failing.
 */
const MAX_DECODES = 2;
let decoding = 0;
const waiting: (() => void)[] = [];
async function withDecodeSlot<T>(work: () => Promise<T>): Promise<T> {
  if (decoding >= MAX_DECODES) await new Promise<void>((resolve) => waiting.push(resolve));
  decoding++;
  try {
    return await work();
  } finally {
    decoding--;
    waiting.shift()?.();
  }
}
export async function normalizeImage(
  data: unknown,
  contentType: string | undefined,
  maxEdge = PRODUCT_IMAGE_EDGE,
) {
  requireCondition(
    Buffer.isBuffer(data) && data.length > 0,
    422,
    'INVALID_IMAGE',
    'Imagem vazia ou ilegível',
  );
  requireCondition(data.length <= MAX_IMAGE_BYTES, 413, 'IMAGE_TOO_LARGE', 'Imagem acima de 5 MiB');
  const format = sniffImage(data);
  requireCondition(
    format !== null &&
      contentType !== undefined &&
      acceptedTypes.has(contentType.split(';')[0]!.trim().toLowerCase()),
    422,
    'UNSUPPORTED_IMAGE_FORMAT',
    'Formato não suportado; use JPEG, PNG ou WebP',
  );
  return withDecodeSlot(async () => {
    try {
      const image = sharp(data, {
        limitInputPixels: MAX_IMAGE_PIXELS,
        // Minor encoder quirks (extra bytes, odd markers) are tolerated; broken data is not.
        failOn: 'error',
        animated: true,
        sequentialRead: true,
      });
      const metadata = await image.metadata();
      requireCondition(
        metadata.format === format && (metadata.pages ?? 1) === 1,
        422,
        'INVALID_IMAGE',
        'Imagem inválida ou animada',
      );
      requireCondition(
        metadata.width &&
          metadata.height &&
          metadata.width <= MAX_IMAGE_SIDE &&
          metadata.height <= MAX_IMAGE_SIDE &&
          metadata.width * metadata.height <= MAX_IMAGE_PIXELS,
        422,
        'IMAGE_RESOLUTION_LIMIT',
        'Resolução acima de 50 megapixels',
      );
      const result = await image
        .rotate()
        .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      requireCondition(
        result.data.length <= MAX_IMAGE_BYTES,
        422,
        'INVALID_IMAGE',
        'Imagem normalizada muito grande',
      );
      return { data: result.data, width: result.info.width, height: result.info.height };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(422, 'INVALID_IMAGE', 'Imagem inválida');
    }
  });
}
export class ImageService {
  constructor(
    readonly products: ProductService,
    readonly firebase: Firebase,
  ) {}
  private object(tenantId: string, productId: string, imageId: string) {
    return this.firebase.bucket.file(`tenants/${tenantId}/products/${productId}/${imageId}.webp`);
  }
  private cleanupRef(tenantId: string, imageId: string) {
    return this.products.repo.foundation.db
      .collection('tenants')
      .doc(opaqueId.parse(tenantId))
      .collection('imageCleanup')
      .doc(opaqueId.parse(imageId));
  }
  async cleanup(actor: Actor, tenantId: string, productId: string, imageId: string) {
    const ref = this.cleanupRef(tenantId, imageId);
    const allowed = await this.products.repo.foundation.db.runTransaction(async (tx) => {
      const product = await this.products.read(actor, tenantId, productId, tx, true);
      const job = (await tx.get(ref)).data();
      if (!job || product.image?.id === imageId) return false;
      // Age alone cannot prove an upload RPC has ended. Crash-orphan uploads need supervised recovery.
      if (job.kind === 'uploading') return false;
      requireCondition(
        job.tenantId === tenantId &&
          job.productId === productId &&
          job.imageId === imageId &&
          ['retired', 'abandoned'].includes(String(job.kind)) &&
          job.notBefore instanceof Timestamp &&
          ['pending', 'deleting'].includes(String(job.status)),
        409,
        'CONFLICT',
        'Limpeza inconsistente',
      );
      if (job.notBefore.toMillis() > this.products.clock().getTime()) return false;
      // setImage reads this claim before attaching. Immutable IDs cannot be reattached after retirement.
      tx.update(ref, { status: 'deleting' });
      return true;
    });
    if (!allowed) return false;
    await this.object(tenantId, productId, imageId).delete({ ignoreNotFound: true });
    await ref.delete();
    return true;
  }
  async upload(
    actor: Actor,
    tenantId: string,
    id: string,
    version: number,
    body: unknown,
    type?: string,
  ) {
    const previous = await this.products.read(actor, tenantId, id, undefined, true);
    requireCondition(previous.version === version, 409, 'CONFLICT', 'Versão desatualizada');
    const normalized = await normalizeImage(body, type);
    const image = imageView.parse({
      id: randomUUID(),
      contentType: 'image/webp',
      sizeBytes: normalized.data.length,
      width: normalized.width,
      height: normalized.height,
    });
    const file = this.object(tenantId, id, image.id);
    const cleanup = this.cleanupRef(tenantId, image.id);
    await cleanup.create({
      tenantId,
      productId: id,
      imageId: image.id,
      status: 'pending',
      kind: 'uploading',
      notBefore: Timestamp.fromMillis(this.products.clock().getTime() + 86400000),
    });
    try {
      await file.save(normalized.data, {
        resumable: false,
        metadata: { contentType: 'image/webp', cacheControl: 'private, no-store' },
      });
    } catch (error) {
      // Grace period protects an uncertain Storage acknowledgement; keep the durable candidate on cleanup failure.
      await cleanup.update({ kind: 'abandoned' }).catch(() => undefined);
      throw error;
    }
    try {
      return await this.setImage(actor, tenantId, id, version, image);
    } catch (error) {
      // A lost commit acknowledgement must never delete the image that was just attached.
      // Only this operation's generated object may be deleted. Never accept a caller path.
      await cleanup
        .update({
          kind: 'abandoned',
          notBefore: Timestamp.fromMillis(this.products.clock().getTime()),
        })
        .then(() => this.cleanup(actor, tenantId, id, image.id))
        .catch(() => undefined);
      throw error;
    }
  }
  private async setImage(
    actor: Actor,
    tenantId: string,
    id: string,
    version: number,
    image: ReturnType<typeof imageView.parse> | null,
  ) {
    const { repo, clock } = this.products;
    return repo.foundation.db.runTransaction(async (tx) => {
      const product = await this.products.read(actor, tenantId, id, tx, true);
      if (image) {
        const candidate = (await tx.get(this.cleanupRef(tenantId, image.id))).data();
        requireCondition(
          candidate?.status === 'pending' &&
            candidate.kind === 'uploading' &&
            candidate.productId === id &&
            candidate.tenantId === tenantId,
          409,
          'CONFLICT',
          'Upload em limpeza; repita com nova imagem',
        );
      }
      requireCondition(product.version === version, 409, 'CONFLICT', 'Versão desatualizada');
      const now = clock().toISOString();
      const next = productSchema.parse({
        ...product,
        image,
        version: product.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
      });
      tx.set(repo.ref(tenantId, 'products', id), next);
      if (image) tx.delete(this.cleanupRef(tenantId, image.id));
      if (product.image)
        tx.create(this.cleanupRef(tenantId, product.image.id), {
          tenantId,
          productId: id,
          imageId: product.image.id,
          status: 'pending',
          kind: 'retired',
          notBefore: Timestamp.fromMillis(clock().getTime() + 86400000),
        });
      recordAudit(
        repo.foundation,
        tx,
        actor,
        tenantId,
        image ? 'product.image.updated' : 'product.image.removed',
        id,
        now,
        { imageId: image?.id ?? null },
      );
      return next;
    });
  }
  async remove(actor: Actor, tenantId: string, id: string, version: number) {
    return this.setImage(actor, tenantId, id, version, null);
  }
  /**
   * JPEG thumbnails for order PDFs, by product id: about 15 mm printed, white behind
   * transparency, a few KB each so a 50-item order stays small enough for WhatsApp. A photo that
   * is missing, slow or unreadable is skipped and the line prints without it; the document is
   * never blocked by one image.
   */
  async pdfThumbnails(
    tenantId: string,
    images: Readonly<Record<string, { id: string; sizeBytes: number }>>,
  ): Promise<Map<string, Buffer>> {
    const entries = Object.entries(images).slice(0, PDF_THUMBNAIL_LIMIT);
    const result = new Map<string, Buffer>();
    let next = 0;
    const worker = async () => {
      while (next < entries.length) {
        const [productId, image] = entries[next++]!;
        const thumbnail = await this.thumbnail(tenantId, productId, image).catch(() => null);
        if (thumbnail) result.set(productId, thumbnail);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, entries.length) }, worker));
    return result;
  }
  private async thumbnail(
    tenantId: string,
    productId: string,
    image: { id: string; sizeBytes: number },
  ): Promise<Buffer | null> {
    const download = this.object(tenantId, productId, image.id).download();
    void download.catch(() => undefined);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000).unref());
    const result = await Promise.race([download, timeout]);
    const data = result?.[0];
    if (!data || data.length !== image.sizeBytes || data.length > MAX_IMAGE_BYTES) return null;
    return sharp(data, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'none' })
      .resize({
        width: PDF_THUMBNAIL_PX,
        height: PDF_THUMBNAIL_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 72 })
      .toBuffer();
  }
  async download(actor: Actor, tenantId: string, id: string) {
    const product = await this.products.read(actor, tenantId, id);
    requireCondition(product.image, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
    const [data] = await this.object(tenantId, id, product.image.id).download();
    requireCondition(
      data.length === product.image.sizeBytes && data.length <= MAX_IMAGE_BYTES,
      500,
      'INTERNAL_ERROR',
      'Erro interno do servidor',
    );
    // Recheck after Storage I/O, including assignment-independent product access and suspension.
    const current = await this.products.read(actor, tenantId, id);
    requireCondition(
      current.image?.id === product.image.id,
      409,
      'CONFLICT',
      'Imagem alterada; tente novamente',
    );
    return data;
  }
}
