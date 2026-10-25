import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { z } from 'zod';
import type { Firebase } from '../../infrastructure/firebase/client.js';
import type { FoundationRepository } from '../../infrastructure/repositories/foundationRepository.js';
import type { AccessService } from '../auth/accessService.js';
import type { Actor } from '../../shared/types/context.js';
import { requireCondition } from '../../shared/errors/appError.js';
import {
  opaqueId,
  tenantLogoSchema,
  tenantSchema,
  type Tenant,
} from '../../shared/schemas/models.js';
import { tenantView } from '../../shared/schemas/http.js';
import { recordAudit } from '../../shared/audit/audit.js';
import { MAX_IMAGE_BYTES, normalizeImage } from '../products/imageService.js';
import { subscriptionSchema } from '../../shared/schemas/models.js';
import type { Permission } from '../users/permissions.js';
import { brandingAllowed, entitlementsFor } from '../plans/catalog.js';
import type { PdfImage } from '../documents/pdfLayout.js';

/** Storage path of a company logo; the same object serves the app, PDFs and the catalog. */
export const logoObjectPath = (tenantId: string, logoId: string) =>
  `tenants/${opaqueId.parse(tenantId)}/branding/${opaqueId.parse(logoId)}.webp`;
/** Longest edge kept for logos: enough for screens and the PDF header. */
export const LOGO_EDGE = 1024;
type Logo = z.infer<typeof tenantLogoSchema>;

/**
 * Company logo. Bytes live in the company's own Storage prefix and are only served through the
 * authenticated API of that company. The object is saved before the versioned link; once the
 * link changes, the object it no longer names is deleted, so replacing or removing a logo does
 * not leave files behind.
 *
 * Sending a logo needs `branding:manage`, which only exists while the plan includes
 * `branding.custom` (Profissional). Without it the stored logo is kept (never deleted by a
 * downgrade), can still be viewed or removed by whoever has `tenant:update`, and simply stops
 * appearing in new PDFs and in the catalog until the plan includes the feature again.
 */
export class TenantLogoService {
  constructor(
    readonly repo: FoundationRepository,
    readonly access: AccessService,
    readonly firebase: Firebase,
    readonly clock: () => Date,
  ) {}
  private object(tenantId: string, logoId: string) {
    return this.firebase.bucket.file(logoObjectPath(tenantId, logoId));
  }
  private async discard(tenantId: string, logo: Logo | null) {
    // Best effort: a failed delete only leaves an unreferenced private object behind.
    if (logo)
      await this.object(tenantId, logo.id)
        .delete({ ignoreNotFound: true })
        .catch(() => undefined);
  }
  private async current(tenantId: string) {
    return this.repo.read(this.repo.global('tenants', tenantId), tenantSchema);
  }
  /** Logo id the company references now; undefined when it cannot be read. */
  private async linkedId(tenantId: string): Promise<string | null | undefined> {
    return this.current(tenantId).then(
      (tenant) => tenant?.logo?.id ?? null,
      () => undefined,
    );
  }
  private link(
    actor: Actor,
    tenantId: string,
    expectedVersion: number,
    logo: Logo | null,
    permission: Permission,
  ) {
    return this.repo.db.runTransaction(async (tx) => {
      const ctx = await this.access.tenant(actor, tenantId, permission, tx);
      requireCondition(
        ctx.tenant.version === expectedVersion,
        409,
        'CONFLICT',
        'Versão desatualizada',
      );
      requireCondition(logo || ctx.tenant.logo, 404, 'RESOURCE_NOT_FOUND', 'Empresa sem logotipo');
      const now = this.clock().toISOString();
      const next = tenantSchema.parse({
        ...ctx.tenant,
        logo,
        version: ctx.tenant.version + 1,
        updatedAt: now,
      });
      tx.set(this.repo.global('tenants', tenantId), next);
      recordAudit(
        this.repo,
        tx,
        actor,
        tenantId,
        logo ? 'tenant.logo.updated' : 'tenant.logo.removed',
        tenantId,
        now,
        { previousLogoId: ctx.tenant.logo?.id ?? null, logoId: logo?.id ?? null },
      );
      return tenantView.parse(next);
    });
  }
  async upload(
    actor: Actor,
    tenantId: string,
    expectedVersion: number,
    body: unknown,
    type?: string,
  ) {
    // Permission, plan and version are checked before any byte is decoded or stored.
    const before = await this.access.tenant(actor, tenantId, 'branding:manage');
    requireCondition(
      before.tenant.version === expectedVersion,
      409,
      'CONFLICT',
      'Versão desatualizada',
    );
    const normalized = await normalizeImage(body, type, LOGO_EDGE);
    const logo = tenantLogoSchema.parse({
      id: randomUUID(),
      contentType: 'image/webp',
      sizeBytes: normalized.data.length,
      width: normalized.width,
      height: normalized.height,
    });
    await this.object(tenantId, logo.id).save(normalized.data, {
      resumable: false,
      metadata: { contentType: 'image/webp', cacheControl: 'private, no-store' },
    });
    try {
      const view = await this.link(actor, tenantId, expectedVersion, logo, 'branding:manage');
      await this.discard(tenantId, before.tenant.logo);
      return view;
    } catch (error) {
      // A lost commit acknowledgement may still have linked the new logo: decide by rereading,
      // and keep both objects when even that read fails.
      const linked = await this.linkedId(tenantId);
      if (linked !== undefined && linked !== logo.id) await this.discard(tenantId, logo);
      else if (linked === logo.id) await this.discard(tenantId, before.tenant.logo);
      throw error;
    }
  }
  async remove(actor: Actor, tenantId: string, expectedVersion: number) {
    const before = await this.access.tenant(actor, tenantId, 'tenant:update');
    try {
      const view = await this.link(actor, tenantId, expectedVersion, null, 'tenant:update');
      await this.discard(tenantId, before.tenant.logo);
      return view;
    } catch (error) {
      const linked = await this.linkedId(tenantId);
      if (linked !== undefined && linked !== before.tenant.logo?.id)
        await this.discard(tenantId, before.tenant.logo);
      throw error;
    }
  }
  async download(actor: Actor, tenantId: string) {
    const { tenant } = await this.access.tenant(actor, tenantId, 'tenant:read');
    requireCondition(tenant.logo, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
    const data = await this.bytes(tenantId, tenant.logo);
    requireCondition(data, 404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
    return data;
  }
  /** Stored bytes, or null when missing or inconsistent with the record. */
  async bytes(tenantId: string, logo: Logo): Promise<Buffer | null> {
    try {
      const [data] = await this.object(tenantId, logo.id).download();
      return data.length === logo.sizeBytes && data.length <= MAX_IMAGE_BYTES ? data : null;
    } catch {
      return null;
    }
  }
  /**
   * PNG for PDF headers (PDFKit does not read WebP). A missing or unreadable logo yields null
   * and the document keeps the company name alone; it never blocks the document. `branded`
   * comes from the plan (see brandingAllowed): without it the result is null, whatever is stored.
   */
  async pdfLogo(tenant: Pick<Tenant, 'id' | 'logo'>, branded: boolean): Promise<PdfImage | null> {
    if (!tenant.logo || !branded) return null;
    const data = await this.bytes(tenant.id, tenant.logo);
    if (!data) return null;
    try {
      const png = await sharp(data, { limitInputPixels: LOGO_EDGE * LOGO_EDGE })
        .resize({ width: 480, height: 160, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer({ resolveWithObject: true });
      return { data: png.data, width: png.info.width, height: png.info.height };
    } catch {
      return null;
    }
  }
  /** Same as `pdfLogo`, for callers that only hold the company id. */
  async pdfLogoFor(tenantId: string): Promise<PdfImage | null> {
    const tenant = await this.current(tenantId).catch(() => null);
    if (!tenant?.logo) return null;
    const subscription = await this.repo
      .read(this.repo.global('subscriptions', tenant.subscriptionId), subscriptionSchema)
      .catch(() => null);
    if (subscription?.tenantId !== tenant.id) return null;
    return this.pdfLogo(tenant, brandingAllowed(entitlementsFor(subscription)));
  }
}
