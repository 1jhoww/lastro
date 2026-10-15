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
const formats: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export async function normalizeImage(data: unknown, contentType: string | undefined) {
  requireCondition(
    Buffer.isBuffer(data) &&
      data.length > 0 &&
      data.length <= MAX_IMAGE_BYTES &&
      contentType &&
      formats[contentType],
    422,
    'INVALID_IMAGE',
    'Imagem inválida; use JPEG, PNG ou WebP até 5 MiB',
  );
  try {
    const image = sharp(data, { limitInputPixels: 16_000_000, failOn: 'warning', animated: true });
    const metadata = await image.metadata();
    requireCondition(
      metadata.format === formats[contentType] &&
        (metadata.pages ?? 1) === 1 &&
        metadata.width &&
        metadata.height &&
        metadata.width <= 8192 &&
        metadata.height <= 8192,
      422,
      'INVALID_IMAGE',
      'Imagem inválida',
    );
    const result = await image.rotate().webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
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
