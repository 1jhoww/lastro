import type { Actor } from '../../shared/types/context.js';
import type { OrderService } from '../orders/orderService.js';
import { digest, stableJson } from '../../shared/utils/crypto.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { PdfRenderer, type DocumentSource } from './pdfRenderer.js';
import type { Download } from './download.js';
import { ReadGate, checkReadBudget, documentPolicy } from '../../shared/operations/readBudget.js';

export class DocumentService {
  private inFlight = 0;
  constructor(
    readonly orders: OrderService,
    readonly renderer = new PdfRenderer(),
    readonly budget = new ReadGate(),
  ) {}
  async source(actor: Actor, tenantId: string, id: string): Promise<DocumentSource> {
    return this.orders.repo.foundation.db.runTransaction(
      async (tx) => {
        const source = await this.orders.authorizedSnapshot(tx, actor, tenantId, id);
        const customer = source.customer;
        return {
          tenant: source.tenant,
          order: source.order,
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
      const fingerprint = digest(stableJson(source));
      const bytes = await this.renderer.render(source, kind, this.orders.clock());
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
