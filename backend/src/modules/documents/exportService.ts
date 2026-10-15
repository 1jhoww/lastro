import type { z } from 'zod';
import type { Actor } from '../../shared/types/context.js';
import type { CustomerService } from '../customers/customerService.js';
import type { ProductService } from '../products/productService.js';
import type { CategoryService } from '../categories/categoryService.js';
import type { OrderService } from '../orders/orderService.js';
import type { FinancialReads } from '../finance/financialReads.js';
import * as s from '../../shared/schemas/documents.js';
import { csvBytes, decimalCents, brazilianDate } from './csv.js';
import type { Download } from './download.js';
import { AppError, requireCondition } from '../../shared/errors/appError.js';
import { ReadGate, checkReadBudget, exportPolicy } from '../../shared/operations/readBudget.js';

export const MAX_EXPORT_MS = 30_000;

export class ExportService {
  private inFlight = 0;
  constructor(
    readonly customers: CustomerService,
    readonly products: ProductService,
    readonly categories: CategoryService,
    readonly orders: OrderService,
    readonly financial: FinancialReads,
    readonly budget = new ReadGate(),
  ) {}
  async download(
    actor: Actor,
    tenantId: string,
    resource: 'customers' | 'products' | 'orders' | 'receivables',
    input: unknown,
  ) {
    return this.budget.run(
      () => this.generate(actor, tenantId, resource, input),
      undefined,
      exportPolicy,
    );
  }
  private async generate(
    actor: Actor,
    tenantId: string,
    resource: 'customers' | 'products' | 'orders' | 'receivables',
    input: unknown,
  ) {
    requireCondition(this.inFlight < 2, 429, 'EXPORT_BUSY', 'Exportação ocupada; tente novamente');
    this.inFlight++;
    const start = performance.now();
    const check = () => {
      checkReadBudget();
      if (performance.now() - start > MAX_EXPORT_MS)
        throw new AppError(413, 'EXPORT_TIME_LIMIT', 'Exportação excede tempo técnico');
    };
    try {
      const result =
        resource === 'customers'
          ? await this.customer(actor, tenantId, s.customerExportQuery.parse(input))
          : resource === 'products'
            ? await this.product(actor, tenantId, s.productExportQuery.parse(input), check)
            : resource === 'orders'
              ? await this.order(actor, tenantId, s.orderExportQuery.parse(input))
              : await this.receivable(actor, tenantId, s.receivableExportQuery.parse(input), check);
      check();
      return result;
    } finally {
      this.inFlight--;
    }
  }
  private async gate(actor: Actor, tenantId: string, financial = false) {
    checkReadBudget();
    await this.orders.access.tenant(actor, tenantId, 'reports:read');
    if (financial) await this.orders.access.tenant(actor, tenantId, 'receivables:read');
  }
  private async finish(
    actor: Actor,
    tenantId: string,
    kind: string,
    headers: string[],
    rows: (string | number | null | undefined)[][],
    nextCursor: string | null,
    financial = false,
    orderIds: string[] = [],
  ): Promise<Download> {
    checkReadBudget();
    const bytes = csvBytes(headers, rows);
    await this.gate(actor, tenantId, financial);
    if (orderIds.length)
      await this.orders.repo.foundation.db.runTransaction(async (tx) => {
        await this.orders.access.tenant(actor, tenantId, 'reports:read', tx);
        if (financial) await this.orders.access.tenant(actor, tenantId, 'receivables:read', tx);
        for (const id of new Set(orderIds)) {
          checkReadBudget();
          await this.orders.financialLocks.assertOrderAvailable(tx, tenantId, id, true);
        }
      });
    return { bytes, filename: `${kind}.csv`, rowCount: rows.length, nextCursor };
  }
  async customer(actor: Actor, tenantId: string, input: z.infer<typeof s.customerExportQuery>) {
    await this.gate(actor, tenantId);
    const page = await this.customers.list(actor, tenantId, input);
    return this.finish(
      actor,
      tenantId,
      'clientes',
      [
        'Nome',
        'Nome fantasia',
        'CPF/CNPJ',
        'Email',
        'Telefone',
        'Endereço',
        'Situação',
        'Observações comerciais',
      ],
      page.items.map((c) => [
        c.name,
        c.tradeName,
        c.document,
        c.email,
        c.phone,
        c.address
          ? [
              c.address.street,
              c.address.number,
              c.address.complement,
              c.address.district,
              c.address.city,
              c.address.state,
              c.address.postalCode,
              c.address.country,
            ]
              .filter(Boolean)
              .join(', ')
          : '',
        c.status,
        c.notes,
      ]),
      page.nextCursor,
    );
  }
  private async product(
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof s.productExportQuery>,
    check: () => void,
  ) {
    await this.gate(actor, tenantId);
    const page = await this.products.list(actor, tenantId, input);
    const categories = new Map<string, string>();
    for (const id of new Set(
      page.items.map((p) => p.categoryId).filter((v): v is string => v !== null),
    )) {
      check();
      const category = await this.categories.read(actor, tenantId, id);
      categories.set(id, category.name);
    }
    return this.finish(
      actor,
      tenantId,
      'produtos',
      ['Nome', 'SKU', 'Categoria', 'Unidade', 'Preço de venda BRL', 'Situação'],
      page.items.map((p) => [
        p.name,
        p.sku,
        p.categoryId ? categories.get(p.categoryId) : '',
        p.unit,
        decimalCents(p.priceCents),
        p.status,
      ]),
      page.nextCursor,
    );
  }
  private async order(actor: Actor, tenantId: string, input: z.infer<typeof s.orderExportQuery>) {
    await this.gate(actor, tenantId);
    const page = await this.orders.list(
      actor,
      tenantId,
      { ...input, limit: input.limit ?? '10' },
      true,
    );
    return this.finish(
      actor,
      tenantId,
      'pedidos',
      [
        'Pedido',
        'Cliente histórico',
        'Data do pedido UTC',
        'Situação',
        'Subtotal BRL',
        'Desconto BRL',
        'Total BRL',
      ],
      page.items.map((o) => [
        o.commercialId,
        o.customerName,
        brazilianDate(o.createdAt),
        o.status,
        decimalCents(o.subtotalCents),
        decimalCents(o.discountCents),
        decimalCents(o.totalCents),
      ]),
      page.nextCursor,
      false,
      page.items.map((o) => o.id),
    );
  }
  private async receivable(
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof s.receivableExportQuery>,
    check: () => void,
  ) {
    await this.gate(actor, tenantId, true);
    const page = await this.financial.titles(
      actor,
      tenantId,
      {
        ...input,
        limit: input.limit ?? '10',
      },
      true,
    );
    const names = new Map<string, string>();
    for (const id of new Set(page.items.map((t) => t.orderId))) {
      check();
      names.set(id, (await this.orders.read(actor, tenantId, id)).commercialId);
    }
    return this.finish(
      actor,
      tenantId,
      'contas-a-receber',
      [
        'Cliente histórico',
        'Pedido',
        'Parcela',
        'Vencimento',
        'Valor original BRL',
        'Saldo BRL',
        'Situação',
      ],
      page.items.map((t) => [
        t.customerName,
        names.get(t.orderId),
        t.installmentNumber,
        brazilianDate(t.dueDate),
        decimalCents(t.originalCents),
        decimalCents(t.outstandingCents),
        t.status,
      ]),
      page.nextCursor,
      true,
      page.items.map((t) => t.orderId),
    );
  }
}
