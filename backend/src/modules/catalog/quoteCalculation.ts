import { createHmac } from 'node:crypto';
import type { z } from 'zod';
import type { quoteSummary } from '../../shared/schemas/catalog.js';
import { stableJson } from '../../shared/utils/crypto.js';
import { requireCondition } from '../../shared/errors/appError.js';

export function quoteReviewToken(
  secret: string,
  tenantId: string,
  summary: z.infer<typeof quoteSummary>,
) {
  return createHmac('sha256', secret)
    .update(`catalog-review:${tenantId}:${stableJson(summary)}`)
    .digest('hex');
}
export function messageText(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\p{Cc}\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu, ' ')
    .replace(/(?:https?:\/\/|www\.|wa\.me\/)[^\s]+/giu, '[link removido]')
    .replace(/[.*_~`<>\u005b\u005d\\]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
const money = (value: number) =>
  `R$ ${Math.floor(value / 100).toString()}.${(value % 100).toString().padStart(2, '0')}`.replace(
    '.',
    ',',
  );
export function quoteMessage(summary: z.infer<typeof quoteSummary>) {
  const rows = [
    `Olá! Gostaria de solicitar um orçamento à ${messageText(summary.catalog.tradeName)}:`,
    '',
    ...summary.lines.map(
      (line) =>
        `• ${line.quantity} ${line.unit} × ${messageText(line.name)}` +
        (line.unitPriceCents !== null && line.subtotalCents !== null
          ? ` (${money(line.unitPriceCents)}/${line.unit}) — ${money(line.subtotalCents)}`
          : ''),
    ),
    ...(summary.totalEstimatedCents !== null
      ? ['', `Total estimado: ${money(summary.totalEstimatedCents)}`]
      : []),
    '',
    'Não é pedido confirmado. Valores e disponibilidade sujeitos à confirmação.',
    'Aguardo o retorno. Obrigado!',
  ];
  return rows.join('\n');
}
export function whatsappLink(number: string, message: string) {
  requireCondition(
    /^[1-9][0-9]{7,14}$/.test(number),
    500,
    'INTERNAL_ERROR',
    'Erro interno do servidor',
  );
  const link = new URL(`https://wa.me/${number}`);
  link.searchParams.set('text', message);
  requireCondition(
    message.length <= 12000 && link.href.length <= 16000,
    413,
    'QUOTE_MESSAGE_LIMIT',
    'Mensagem acima do limite técnico; reduza os itens ou quantidades',
  );
  return link.href;
}
