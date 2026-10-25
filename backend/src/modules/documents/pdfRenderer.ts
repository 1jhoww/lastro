import { AppError } from '../../shared/errors/appError.js';
import type { Order } from '../../shared/schemas/orders.js';
import type { Tenant } from '../../shared/schemas/models.js';
import {
  BrandedPdf,
  LEFT,
  RIGHT,
  WIDTH,
  brQuantity,
  brl,
  calendarDate,
  localDate,
  oneLine,
  orderNumber,
  type Cell,
  type PdfImage,
} from './pdfLayout.js';

export { MAX_PDF_BYTES, MAX_PDF_PAGES, MAX_RENDER_MS } from './pdfLayout.js';

/** Registration data of the customer. The order itself keeps only the historical name. */
export interface CustomerContact {
  tradeName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  address: {
    street?: string | undefined;
    number?: string | undefined;
    complement?: string | undefined;
    district?: string | undefined;
    city?: string | undefined;
    state?: string | undefined;
    postalCode?: string | undefined;
  } | null;
}
export interface DocumentSource {
  tenant: { id?: string; name: string; timezone: string; logo?: Tenant['logo'] };
  /** Plan includes the company identity (branding.custom); absent means plain documents. */
  branded?: boolean;
  /** Current photo of each product in the order, by product id (branded documents only). */
  productImages?: Record<string, { id: string; sizeBytes: number }>;
  order: Order;
  customer: CustomerContact | null;
}

export const COMMERCIAL_FOOTER = 'Documento comercial gerado pelo Lastro. Não possui valor fiscal.';
export const PACKING_FOOTER = 'Gerado pelo Lastro — Documento não fiscal.';
export const RECEIPT_DECLARATION =
  'Declaro o recebimento dos produtos e quantidades relacionados acima.';

/** CPF 000.000.000-00 or CNPJ 00.000.000/0000-00 (alphanumeric CNPJ keeps its characters). */
export function formatDocument(value: string) {
  const v = value.replace(/[.\-/\s]/g, '').toUpperCase();
  if (/^\d{11}$/.test(v)) return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
  if (/^[A-Z0-9]{12}\d{2}$/.test(v))
    return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
  return value;
}
/** (11) 98765-4321 for Brazilian numbers; anything else is shown as registered. */
export function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  const local = digits.length >= 12 && digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return value;
}
export function addressLines(address: CustomerContact['address']): string[] {
  if (!address) return [];
  const street = [address.street, address.number, address.complement].filter(Boolean).join(', ');
  const city = [address.city, address.state].filter(Boolean).join('/');
  const place = [address.district, city].filter(Boolean).join(' — ');
  const postal = address.postalCode
    ? `CEP ${address.postalCode.replace(/^(\d{5})(\d{3})$/, '$1-$2')}`
    : '';
  return [street, [place, postal].filter(Boolean).join(' — ')].filter(Boolean);
}
const quantity = (line: Order['lines'][number]) => `${brQuantity(line.quantity)} ${line.unit}`;
/** Full product name and SKU from the order line; the photo is looked up by product id. */
const productCell = (
  line: Order['lines'][number],
  thumbnails: ReadonlyMap<string, Buffer>,
): Cell => {
  const image = thumbnails.get(line.productId);
  return { text: oneLine(line.name), sub: `SKU ${oneLine(line.sku)}`, ...(image ? { image } : {}) };
};

export class PdfRenderer {
  async render(
    source: DocumentSource,
    kind: 'commercial' | 'packing',
    emittedAt: Date,
    /** Company logo as PNG (see TenantLogoService.pdfLogo); null keeps the name alone. */
    logo: PdfImage | null = null,
    /** Product thumbnails by product id (ImageService.pdfThumbnails); missing ones print none. */
    thumbnails: ReadonlyMap<string, Buffer> = new Map(),
  ): Promise<Buffer> {
    const { order } = source;
    if (kind === 'packing' && order.status !== 'confirmed' && order.status !== 'dispatched')
      throw new AppError(
        409,
        'DOCUMENT_UNAVAILABLE',
        'Romaneio disponível somente para pedido confirmado ou expedido',
      );
    const pdf = new BrandedPdf(
      kind === 'commercial'
        ? {
            company: source.tenant.name,
            logo,
            title: 'PEDIDO COMERCIAL',
            subtitle: 'Documento não fiscal',
            reference: orderNumber(order.commercialId),
          }
        : {
            company: source.tenant.name,
            logo,
            title: 'ROMANEIO DE ENTREGA',
            subtitle: 'Comprovante de recebimento — Documento não fiscal',
            reference: orderNumber(order.commercialId),
          },
      kind === 'commercial' ? COMMERCIAL_FOOTER : PACKING_FOOTER,
      {
        title: `${kind === 'commercial' ? 'Pedido comercial' : 'Romaneio de entrega'} ${orderNumber(order.commercialId)}`,
        createdAt: emittedAt,
      },
    );
    try {
      pdf.newPage();
      this.parties(pdf, source, kind);
      if (kind === 'commercial') await this.commercial(pdf, source, thumbnails);
      else await this.packing(pdf, source, thumbnails);
      return await pdf.finish();
    } catch (error) {
      pdf.destroy();
      throw error;
    }
  }

  /** Customer on the left, order reference on the right. Only data that exists is printed. */
  private parties(pdf: BrandedPdf, source: DocumentSource, kind: 'commercial' | 'packing') {
    const { order, customer } = source;
    const leftWidth = 320,
      rightX = LEFT + 345,
      rightWidth = RIGHT - rightX;
    const top = pdf.y;
    let left = top + pdf.label(kind === 'commercial' ? 'CLIENTE' : 'DESTINATÁRIO', LEFT, top);
    const name = order.customerName ? oneLine(order.customerName) : 'Cliente não informado';
    left += pdf.write(name, LEFT, left, leftWidth, { size: 10.5, bold: true }) + 3;
    const details: string[] = [];
    if (customer?.tradeName && oneLine(customer.tradeName) !== name)
      details.push(oneLine(customer.tradeName));
    if (customer?.document)
      details.push(
        `${customer.document.replace(/\D/g, '').length === 11 ? 'CPF' : 'CNPJ'} ${formatDocument(customer.document)}`,
      );
    const contact = [
      customer?.phone ? formatPhone(customer.phone) : null,
      customer?.email ?? null,
    ].filter((v): v is string => Boolean(v));
    if (contact.length) details.push(contact.join(' · '));
    for (const line of details)
      left += pdf.write(line, LEFT, left, leftWidth, { size: 8.5, color: '#333333' }) + 1.5;
    const address = addressLines(customer?.address ?? null);
    if (address.length) {
      left += 6;
      left += pdf.label(kind === 'packing' ? 'ENDEREÇO DE ENTREGA' : 'ENDEREÇO', LEFT, left);
      for (const line of address)
        left += pdf.write(line, LEFT, left, leftWidth, { size: 8.5, color: '#333333' }) + 1.5;
    }

    let right =
      top + pdf.label(kind === 'commercial' ? 'PEDIDO' : 'PEDIDO DE REFERÊNCIA', rightX, top);
    const pair = (label: string, value: string, strong = false) => {
      pdf.write(label, rightX, right + (strong ? 2 : 0), 82, { size: 8.5, color: '#5E5E5E' });
      right +=
        Math.max(
          pdf.write(value, rightX + 84, right, rightWidth - 84, {
            size: strong ? 11 : 9,
            bold: strong,
            align: 'right',
          }),
          11,
        ) + 5;
    };
    pair('Número do pedido', orderNumber(order.commercialId), true);
    pair('Data do pedido', localDate(order.createdAt, source.tenant.timezone));
    if (kind === 'commercial' && order.status === 'draft') pair('Situação', 'Rascunho');
    if (kind === 'commercial' && order.status === 'canceled') pair('Situação', 'Cancelado');
    pdf.y = Math.max(left, right) + 14;
  }

  private async commercial(
    pdf: BrandedPdf,
    source: DocumentSource,
    thumbnails: ReadonlyMap<string, Buffer>,
  ) {
    const { order } = source;
    const discount = order.discountCents > 0;
    const totals = [
      ...(discount
        ? [
            { label: 'Subtotal dos produtos', value: brl(order.subtotalCents) },
            { label: 'Desconto', value: `- ${brl(order.discountCents)}` },
          ]
        : []),
      { label: 'TOTAL DO PEDIDO', value: brl(order.totalCents), strong: true },
    ];
    const totalsHeight = (discount ? 34 : 0) + 30;
    if (order.lines.length) {
      const rows: Cell[][] = order.lines.map((line) => [
        productCell(line, thumbnails),
        { text: quantity(line) },
        { text: brl(line.unitPriceCents) },
        { text: brl(line.subtotalCents) },
      ]);
      await pdf.table(
        [
          { label: 'Produto', width: 255 },
          { label: 'Quantidade', width: 80, align: 'right' },
          { label: 'Unitário', width: 90, align: 'right' },
          { label: 'Subtotal', width: 90, align: 'right' },
        ],
        rows,
        totalsHeight + 8,
      );
    } else pdf.paragraph('Pedido sem produtos.', { color: '#5E5E5E' });
    pdf.y += 8;
    pdf.ensure(totalsHeight);
    pdf.totals(totals);
    if (order.discount) {
      pdf.y += 2;
      pdf.paragraph(`Motivo do desconto: ${oneLine(order.discount.reason)}`, {
        size: 8,
        color: '#5E5E5E',
      });
    }
    this.payment(pdf, order);
    if (order.notes.trim()) {
      pdf.y += 10;
      pdf.ensure(40);
      pdf.y += pdf.label('OBSERVAÇÕES');
      pdf.paragraph(order.notes.trim(), { size: 8.5, color: '#333333' });
    }
  }

  /** Commercial conditions recorded in the order (not a payment receipt). */
  private payment(pdf: BrandedPdf, order: Order) {
    const condition = order.paymentTerms
      ? order.paymentTerms.name
      : order.payment
        ? order.payment.type === 'cash'
          ? 'À vista'
          : 'Parcelado'
        : null;
    if (!condition && !order.installments.length) return;
    pdf.y += 14;
    pdf.ensure(36 + order.installments.length * 14);
    pdf.y += pdf.label('CONDIÇÕES DE PAGAMENTO');
    const summary = [
      condition ? oneLine(condition) : null,
      order.intendedPaymentMethod
        ? `Forma prevista: ${oneLine(order.intendedPaymentMethod.name)}`
        : null,
    ].filter(Boolean);
    if (summary.length) pdf.paragraph(summary.join(' · '), { size: 8.5, color: '#333333', gap: 6 });
    if (order.installments.length > 1)
      for (const installment of order.installments) {
        pdf.ensure(14);
        pdf.write(`Parcela ${installment.number}`, LEFT, pdf.y, 120, {
          size: 8.5,
          color: '#333333',
        });
        pdf.write(`Vencimento ${calendarDate(installment.dueDate)}`, LEFT + 120, pdf.y, 160, {
          size: 8.5,
          color: '#333333',
        });
        pdf.write(brl(installment.amountCents), LEFT + 280, pdf.y, 110, {
          size: 8.5,
          align: 'right',
        });
        pdf.y += 13;
      }
    else if (order.installments[0])
      pdf.paragraph(
        `Vencimento ${calendarDate(order.installments[0].dueDate)} · ${brl(order.installments[0].amountCents)}`,
        { size: 8.5, color: '#333333' },
      );
  }

  /**
   * Delivery receipt. Dispatch is always integral in Lastro (no partial dispatch), so each line's
   * quantity is exactly what leaves with this delivery; values are the line totals, discount
   * included, and add up to the order total.
   */
  private async packing(
    pdf: BrandedPdf,
    source: DocumentSource,
    thumbnails: ReadonlyMap<string, Buffer>,
  ) {
    const { order } = source;
    const receiptHeight = 250;
    await pdf.table(
      [
        { label: 'Produto', width: 315 },
        { label: 'Quantidade', width: 95, align: 'right' },
        { label: 'Valor', width: 105, align: 'right' },
      ],
      order.lines.map((line) => [
        productCell(line, thumbnails),
        { text: quantity(line) },
        { text: brl(line.totalCents) },
      ]),
      receiptHeight,
    );
    pdf.y += 8;
    pdf.ensure(receiptHeight);
    pdf.totals([{ label: 'VALOR TOTAL', value: brl(order.totalCents), strong: true }]);
    if (order.discountCents > 0)
      pdf.write('Valores com o desconto do pedido aplicado.', LEFT, pdf.y - 18, 260, {
        size: 7.5,
        color: '#8A8A8A',
      });
    this.receipt(pdf);
  }

  /** Space for handwritten confirmation; printing or signing never changes the order status. */
  private receipt(pdf: BrandedPdf) {
    pdf.y += 22;
    pdf.rule(pdf.y, '#D9D9D9', 0.6);
    pdf.y += 14;
    pdf.y += pdf.label('CONFIRMAÇÃO DE RECEBIMENTO');
    pdf.y += pdf.write(RECEIPT_DECLARATION, LEFT, pdf.y, WIDTH, { size: 9.5 }) + 24;
    const field = (label: string, from: number, to: number, y: number) => {
      pdf.write(label, from, y, to - from, { size: 8.5, color: '#333333' });
      const width = pdf.doc.font('Body').fontSize(8.5).widthOfString(label);
      pdf.rule(y + 10, '#111111', 0.6, from + width + 6, to);
    };
    field('Nome do recebedor:', LEFT, RIGHT, pdf.y);
    pdf.y += 34;
    pdf.write('Data do recebimento:', LEFT, pdf.y, 120, { size: 8.5, color: '#333333' });
    pdf.write('____/____/________', LEFT + 100, pdf.y - 1, 140, { size: 9.5 });
    pdf.y += 38;
    field('Assinatura do recebedor:', LEFT, RIGHT, pdf.y);
    pdf.y += 30;
  }
}
