import { customerQuery, productQuery } from './commercial.js';
import { orderQuery } from './orders.js';
import { titleQuery } from './finance.js';
import { z } from 'zod';

export const customerExportQuery = customerQuery;
export const productExportQuery = productQuery;
export const orderExportQuery = orderQuery.extend({
  limit: z
    .string()
    .regex(/^(?:[1-9]|10)$/)
    .optional()
    .describe('1..10 pedidos por arquivo; padrão 10. Limite técnico de memória, não comercial.'),
});
export const receivableExportQuery = titleQuery.safeExtend({
  limit: z
    .string()
    .regex(/^(?:[1-9]|10)$/)
    .optional()
    .describe('1..10 títulos por arquivo; padrão 10. Limita origens financeiras lidas em memória.'),
});
