import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { orderSchema } from '../../src/shared/schemas/orders.js';
import type { DocumentSource } from '../../src/modules/documents/pdfRenderer.js';

export async function pdfText(bytes: Buffer) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await task.promise;
  try {
    const pages: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const content = await (await pdf.getPage(p)).getTextContent();
      pages.push(content.items.map((i) => ('str' in i ? i.str : '')).join(' '));
    }
    return { pages, text: pages.join('\n'), pageCount: pdf.numPages };
  } finally {
    await task.destroy();
  }
}
export function documentSource(count = 1): DocumentSource {
  const now = '2026-10-09T12:00:00.000Z';
  return {
    tenant: { name: 'Distribuidora São José', timezone: 'America/Sao_Paulo' },
    order: orderSchema.parse({
      id: 'order',
      tenantId: 'tenant',
      commercialId: 'PED-000001',
      customerId: 'customer',
      customerName: 'Márcia Açúcar & Ação',
      sellerUid: 'seller',
      status: 'confirmed',
      lines: Array.from({ length: count }, (_, i) => ({
        id: `line${i}`,
        productId: `product${i}`,
        name: `Produto ${i + 1} - ação, açúcar, coração ${'NomeExtenso'.repeat(10)}`,
        sku: `SKU${i + 1}`,
        description: 'Descrição histórica',
        unit: 'UN',
        quantity: '2',
        unitPriceCents: 1250,
        subtotalCents: 2500,
        discountCents: 0,
        totalCents: 2500,
      })),
      subtotalCents: count * 2500,
      discountCents: 0,
      totalCents: count * 2500,
      discount: null,
      payment: { type: 'cash', dueDates: ['2026-11-09'] },
      installments: [
        {
          id: 'installment',
          orderId: 'order',
          number: 1,
          amountCents: count * 2500,
          dueDate: '2026-11-09',
        },
      ],
      notes: `Observação histórica: ${'Ação acentuada. '.repeat(55)}`,
      version: 2,
      createdAt: now,
      updatedAt: now,
      createdBy: 'actor',
      updatedBy: 'actor',
      confirmedAt: now,
      confirmedBy: 'actor',
      dispatchedAt: null,
      dispatchedBy: null,
      canceledAt: null,
      canceledBy: null,
      dispatchReference: null,
      schemaVersion: 1,
    }),
    returned: [],
  };
}
