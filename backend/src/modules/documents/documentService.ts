import type { Actor } from '../../shared/types/context.js';
import type { OrderService } from '../orders/orderService.js';
import { digest, stableJson } from '../../shared/utils/crypto.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { PdfRenderer, type DocumentSource } from './pdfRenderer.js';
import type { Download } from './download.js';
import { ReadGate, checkReadBudget, documentPolicy } from '../../shared/operations/readBudget.js';
import type { TenantLogoService } from '../tenants/logoService.js';
import type { BonusService } from '../bonuses/bonusService.js';
import { bonusView } from '../../shared/schemas/bonuses.js';
import type { ImageService } from '../products/imageService.js';
import { productSchema } from '../../shared/schemas/commercial.js';

export class DocumentService {
  private inFlight = 0;
  constructor(
    readonly orders: OrderService,
    readonly renderer = new PdfRenderer(),
    readonly budget = new ReadGate(),
    readonly logos?: Pick<TenantLogoService, 'pdfLogo'>,
    readonly images?: Pick<ImageService, 'pdfThumbnails'>,
    readonly bonuses?: BonusService,
  ) {}
  async source(actor: Actor, tenantId: string, id: string): Promise<DocumentSource> {
    return this.orders.repo.foundation.db.runTransaction(
      async (tx) => {
        const source = await this.orders.authorizedSnapshot(tx, actor, tenantId, id);
        const customer = source.customer;
        // Photos are found by product id (never by name), in the same authorized read. Their ids
        // are part of the fingerprint below, so a photo swapped mid-render is caught too.
        const productIds = [
          ...new Set(
            [...source.order.lines, ...(source.bonus?.lines ?? [])].map((l) => l.productId),
          ),
        ];
        const products =
          source.branded && productIds.length
            ? await this.orders.repo.foundation.readMany(
                productIds.map((productId) =>
                  this.orders.repo.ref(tenantId, 'products', productId),
                ),
                productSchema,
                tx,
              )
            : [];
        const productImages = Object.fromEntries(
          products.flatMap((p) =>
            p?.image && p.tenantId === tenantId
              ? [[p.id, { id: p.image.id, sizeBytes: p.image.sizeBytes }]]
              : [],
          ),
        );
        return {
          tenant: source.tenant,
          branded: source.branded,
          productImages,
          order: source.order,
          bonus: source.bonus
            ? { commercialId: source.bonus.commercialId, lines: source.bonus.lines }
            : null,
          // Registration data, read under the same authorization as the order.
          customer: customer
            ? {
                tradeName: customer.tradeName,
                document: customer.document,
                email: customer.email,
                phone: customer.phone,
                address: customer.address,
              }
            : null,
        };
      },
      { readOnly: true },
    );
  }
  async download(
    actor: Actor,
    tenantId: string,
    id: string,
    kind: 'commercial' | 'packing',
  ): Promise<Download> {
    return this.budget.run(
      () => this.generate(actor, tenantId, id, kind),
      undefined,
      documentPolicy,
    );
  }
  /** Same budget, limits and revalidation as the order documents. */
  async bonusReceipt(actor: Actor, tenantId: string, id: string): Promise<Download> {
    return this.budget.run(
      () => this.generateBonus(actor, tenantId, id),
      undefined,
      documentPolicy,
    );
  }
  private async bonusSource(actor: Actor, tenantId: string, id: string) {
    const service = this.bonuses!;
    const source = await this.orders.repo.foundation.db.runTransaction(
      (tx) => service.receipt(tx, actor, tenantId, id),
      { readOnly: true },
    );
    return {
      tenant: source.tenant,
      branded: source.branded,
      bonus: bonusView.parse(source.bonus),
      customer: source.customer
        ? {
            tradeName: source.customer.tradeName,
            document: source.customer.document,
            email: source.customer.email,
            phone: source.customer.phone,
            address: source.customer.address,
          }
        : null,
    };
  }
  private async generateBonus(actor: Actor, tenantId: string, id: string): Promise<Download> {
    requireCondition(this.inFlight < 2, 429, 'DOCUMENT_BUSY', 'Geração ocupada; tente novamente');
    this.inFlight++;
    try {
      const source = await this.bonusSource(actor, tenantId, id);
      checkReadBudget();
      const fingerprint = digest(stableJson(source));
      const { id: companyId, logo: companyLogo } = source.tenant;
      const logo =
        this.logos && companyId && companyLogo
          ? await this.logos.pdfLogo({ id: companyId, logo: companyLogo }, source.branded)
          : null;
      const names = await this.bonuses!.people([source.bonus.responsibleUid]);
      checkReadBudget();
      const bytes = await this.renderer.renderBonus(
        { ...source, responsibleName: names.get(source.bonus.responsibleUid) ?? null },
        this.orders.clock(),
        logo,
      );
      checkReadBudget();
      const current = await this.bonusSource(actor, tenantId, id);
      requireCondition(
        digest(stableJson(current)) === fingerprint,
        409,
        'DOCUMENT_CHANGED',
        'Bonificação alterada durante geração; recarregue',
      );
      return { bytes, filename: `bonificacao-${id}.pdf` };
    } finally {
      this.inFlight--;
    }
  }
  private async generate(
    actor: Actor,
    tenantId: string,
    id: string,
    kind: 'commercial' | 'packing',
  ): Promise<Download> {
    requireCondition(this.inFlight < 2, 429, 'DOCUMENT_BUSY', 'Geração ocupada; tente novamente');
    this.inFlight++;
    try {
      const source = await this.source(actor, tenantId, id);
      checkReadBudget();
      // The source carries the logo id, so a logo swapped mid-render is caught below too.
      const fingerprint = digest(stableJson(source));
      const { id: companyId, logo: companyLogo } = source.tenant;
      const branded = Boolean(source.branded);
      const [logo, thumbnails] = await Promise.all([
        this.logos && companyId && companyLogo
          ? this.logos.pdfLogo({ id: companyId, logo: companyLogo }, branded)
          : null,
        this.images && branded && source.productImages
          ? this.images.pdfThumbnails(tenantId, source.productImages)
          : new Map<string, Buffer>(),
      ]);
      checkReadBudget();
      const bytes = await this.renderer.render(source, kind, this.orders.clock(), logo, thumbnails);
      checkReadBudget();
      const current = await this.source(actor, tenantId, id);
      checkReadBudget();
      requireCondition(
        digest(stableJson(current)) === fingerprint,
        409,
        'DOCUMENT_CHANGED',
        'Pedido alterado durante geração; recarregue',
      );
      return { bytes, filename: `${kind === 'commercial' ? 'pedido' : 'romaneio'}-${id}.pdf` };
    } finally {
      this.inFlight--;
    }
  }
}
