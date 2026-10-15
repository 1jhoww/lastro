import { z } from 'zod';
import { unwrap, type ApiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import type {
  ConditionCreate,
  ConditionUpdate,
  CreditInput,
  CreditReversalInput,
  FinancialResult,
  MethodCreate,
  MethodUpdate,
  PaymentCondition,
  PaymentMethod,
  PaymentReversalInput,
  RefundInput,
} from '@/api/types';
import { intentLedger, outcomeOf, PendingIntentError, withDeadline } from '@/lib/intent';
import { tenantHeader } from '@/session/SessionContext';
import { receiptResultSchema } from './rules';

export type EconomicCommand =
  | { kind: 'apply-credit'; id: string; orderId: string; body: CreditInput }
  | { kind: 'reverse-payment'; id: string; orderId: string; body: PaymentReversalInput }
  | { kind: 'reverse-credit'; id: string; orderId: string; body: CreditReversalInput }
  | { kind: 'confirm-refund'; id: string; orderId: string; body: RefundInput };
export type SettingCommand =
  | { kind: 'create-condition'; body: ConditionCreate }
  | { kind: 'update-condition'; id: string; body: ConditionUpdate }
  | { kind: 'create-method'; body: MethodCreate }
  | { kind: 'update-method'; id: string; body: MethodUpdate };
export type FinanceCommand = EconomicCommand | SettingCommand;
export type FinanceCommandResult = FinancialResult | PaymentCondition | PaymentMethod;
export const commandLabels: Record<FinanceCommand['kind'], string> = {
  'apply-credit': 'Aplicar crédito',
  'reverse-payment': 'Estornar recebimento',
  'reverse-credit': 'Estornar aplicação de crédito',
  'confirm-refund': 'Registrar reembolso realizado',
  'create-condition': 'Criar condição',
  'update-condition': 'Atualizar condição',
  'create-method': 'Criar forma',
  'update-method': 'Atualizar forma',
};
export const sensitiveCommand = (c: FinanceCommand) =>
  c.kind === 'reverse-payment' || c.kind === 'reverse-credit' || c.kind === 'confirm-refund';
export function commandPermission(c: FinanceCommand) {
  if (c.kind === 'apply-credit') return 'payments:manage';
  if (c.kind === 'reverse-payment' || c.kind === 'reverse-credit') return 'payments:reverse';
  if (c.kind === 'confirm-refund') return 'refunds:manage';
  return 'payment-settings:manage';
}

const scheduleResult = z
  .array(
    z.object({
      offsetDays: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      weight: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    }),
  )
  .min(1)
  .max(12);
const settingResult = z.object({
  id: z.string().min(1),
  name: z.string().min(2),
  version: z.number().int().positive(),
  status: z.enum(['active', 'inactive']),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  createdBy: z.string().min(1),
  updatedBy: z.string().min(1),
});
const conditionResult = settingResult.extend({ description: z.string(), schedule: scheduleResult });
const methodResult = settingResult.extend({
  kind: z.enum(['cash', 'pix', 'transfer', 'card', 'boleto', 'other']),
});
const inFlight = new Set<string>();

/** Comandos concretos de B. Intenção inclui rota/tipo além do corpo para impedir replay cruzado. */
export async function sendFinanceCommand(
  api: ApiClient,
  tenantId: string,
  scope: string,
  command: FinanceCommand,
  beforeSend: () => void = () => {},
): Promise<FinanceCommandResult> {
  if (scope.split(':')[1] !== tenantId)
    throw new ApiError(403, 'TENANT_ACCESS_DENIED', 'Intenção pertence a outra empresa');
  if (inFlight.has(scope)) throw new PendingIntentError();
  inFlight.add(scope);
  let wasUnknown = intentLedger.get(scope)?.unknown;
  try {
    wasUnknown = wasUnknown || (await intentLedger.persistedPending(scope));
    const key = await intentLedger.prepare(scope, command);
    command = intentLedger.get(scope)!.body as FinanceCommand;
    beforeSend();
    const header = { ...tenantHeader(tenantId), 'Idempotency-Key': key };
    const result = await withDeadline(async (signal) => {
      switch (command.kind) {
        case 'apply-credit':
          return unwrap(
            api.POST('/api/v1/orders/{id}/credit-applications', {
              params: { header, path: { id: command.id } },
              body: command.body,
              signal,
            }),
          );
        case 'reverse-payment':
          return unwrap(
            api.POST('/api/v1/payments/{id}/reversals', {
              params: { header, path: { id: command.id } },
              body: command.body,
              signal,
            }),
          );
        case 'reverse-credit':
          return unwrap(
            api.POST('/api/v1/credit-applications/{id}/reversals', {
              params: { header, path: { id: command.id } },
              body: command.body,
              signal,
            }),
          );
        case 'confirm-refund':
          return unwrap(
            api.POST('/api/v1/refund-obligations/{id}/confirm', {
              params: { header, path: { id: command.id } },
              body: command.body,
              signal,
            }),
          );
        case 'create-condition':
          return unwrap(
            api.POST('/api/v1/payment-conditions', {
              params: { header },
              body: command.body,
              signal,
            }),
          );
        case 'update-condition':
          return unwrap(
            api.PATCH('/api/v1/payment-conditions/{id}', {
              params: { header, path: { id: command.id } },
              body: command.body,
              signal,
            }),
          );
        case 'create-method':
          return unwrap(
            api.POST('/api/v1/payment-methods', { params: { header }, body: command.body, signal }),
          );
        case 'update-method':
          return unwrap(
            api.PATCH('/api/v1/payment-methods/{id}', {
              params: { header, path: { id: command.id } },
              body: command.body,
              signal,
            }),
          );
      }
    });
    const valid =
      'orderId' in command
        ? receiptResultSchema.safeParse(result).success &&
          'orderId' in result &&
          result.orderId === command.orderId &&
          'amountCents' in result &&
          result.amountCents === command.body.amountCents
        : (command.kind.endsWith('condition') ? conditionResult : methodResult).safeParse(result)
            .success &&
          (!('id' in command) || ('id' in result && result.id === command.id));
    if (!valid)
      throw new ApiError(503, 'REQUEST_OUTCOME_UNKNOWN', 'Resposta incompleta ou divergente');
    await intentLedger.finish(scope);
    return result;
  } catch (error) {
    if (!(error instanceof PendingIntentError)) {
      // Recusa durante recuperação não prova que a primeira tentativa não foi gravada.
      if (wasUnknown || outcomeOf(error).status === 'unknown') intentLedger.markUnknown(scope);
      else await intentLedger.reject(scope);
    }
    throw error;
  } finally {
    inFlight.delete(scope);
  }
}
