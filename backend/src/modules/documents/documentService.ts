import type { Actor } from '../../shared/types/context.js';
import type { OrderService } from '../orders/orderService.js';
import type { ReturnService } from '../returns/returnService.js';
import { formatQuantity } from '../inventory/quantities.js';
import { digest, stableJson } from '../../shared/utils/crypto.js';
import { requireCondition } from '../../shared/errors/appError.js';
import { PdfRenderer, type DocumentSource } from './pdfRenderer.js';
import type { Download } from './download.js';
import { ReadGate, checkReadBudget, documentPolicy } from '../../shared/operations/readBudget.js';

export const DOCUMENT_PROOF_BATCH = 20;

export class DocumentService {
  private inFlight = 0;
  constructor(
    readonly orders: OrderService,
    readonly returns: ReturnService,
    readonly renderer = new PdfRenderer(),
    readonly budget = new ReadGate(),
  ) {}
  async source(
    actor: Actor,
    tenantId: string,
    id: string,
    packing: boolean,
  ): Promise<DocumentSource> {
    return this.orders.repo.foundation.db.runTransaction(
      async (tx) => {
        const source = await this.orders.authorizedSnapshot(tx, actor, tenantId, id);
        const received = new Map<string, string>();
        if (packing && source.order.status === 'dispatched') {
          // Each batch releases its event-proof cache; retain only physical quantities.
          for (let offset = 0; offset < source.order.lines.length; offset += DOCUMENT_PROOF_BATCH) {
            const guards = await this.returns.guards(
              tx,
              { order: source.order },
              source.order.lines
                .slice(offset, offset + DOCUMENT_PROOF_BATCH)
                .map((line) => line.id),
            );
            for (const [lineId, guard] of guards)
              received.set(lineId, formatQuantity(guard.receivedScaled));
          }
        }
        return {
          tenant: source.tenant,
          order: source.order,
          returned: source.order.lines.map((line) => ({
            lineId: line.id,
            received: received.get(line.id) ?? '0',
          })),
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
      const source = await this.source(actor, tenantId, id, kind === 'packing');
      checkReadBudget();
      const fingerprint = digest(stableJson(source));
      const bytes = await this.renderer.render(source, kind, this.orders.clock());
      checkReadBudget();
      const current = await this.source(actor, tenantId, id, kind === 'packing');
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
