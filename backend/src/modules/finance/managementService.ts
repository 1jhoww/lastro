import type { z } from 'zod';
import type { Actor } from '../../shared/types/context.js';
import * as s from '../../shared/schemas/management.js';
import { requireCondition, AppError } from '../../shared/errors/appError.js';
import { recordAudit } from '../../shared/audit/audit.js';
import { ReadGate } from '../../shared/operations/readBudget.js';
import { companyDate } from '../orders/calculation.js';
import { addDays, daysBetween } from '../reports/dates.js';
import type { FinancialReads } from './financialReads.js';
import {
  flowByPeriod,
  openPayables,
  openSupplierCredits,
  profitability,
  projectedFlow,
  realizedMoney,
  recurringForecast,
  type ManagementEnv,
} from './managementData.js';

const MAX_SPAN_DAYS = 366;
const RECEIVABLE_LOOKBACK_DAYS = 365;
const RECEIVABLE_CAP = 3000;

/**
 * Consolidated finance of Lastro Gestão: what is in and out of the cash register, what is expected
 * and what the sales earned. Unpaid titles are never presented as money that moved, and a purchase
 * of goods is never an operating expense: its cost reaches the results through the goods sold.
 */
export class ManagementService {
  private readonly gate = new ReadGate(2);
  constructor(
    readonly financial: FinancialReads,
    readonly zonedStart: (date: string, timezone: string) => string,
  ) {}
  private get commands() {
    return this.financial.commands;
  }
  private get repo() {
    return this.commands.repo;
  }
  private settingsRef(tenantId: string) {
    return this.repo.ref(tenantId, 'financeSettings', 'current');
  }
  async settings(actor: Actor, tenantId: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.commands.access.tenant(actor, tenantId, 'financial-dashboard:read', tx);
        const settings = await this.repo.foundation.read(
          this.settingsRef(tenantId),
          s.financeSettingsSchema,
          tx,
        );
        return {
          openingBalanceCents: settings?.openingBalanceCents ?? null,
          openingDate: settings?.openingDate ?? null,
          version: settings?.version ?? 0,
        };
      },
      { readOnly: true },
    );
  }
  async updateSettings(
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof s.financeSettingsInput>,
  ) {
    return this.repo.foundation.db.runTransaction(async (tx) => {
      const ctx = await this.commands.access.tenant(actor, tenantId, 'payables:manage', tx);
      const previous = await this.repo.foundation.read(
        this.settingsRef(tenantId),
        s.financeSettingsSchema,
        tx,
      );
      requireCondition(
        (previous?.version ?? 0) === input.expectedVersion,
        409,
        'CONFLICT',
        'Versão desatualizada',
      );
      const now = this.commands.clock();
      requireCondition(
        input.openingDate <= companyDate(now, ctx.tenant.timezone),
        422,
        'VALIDATION_ERROR',
        'A data do saldo não pode ser futura',
      );
      const next = s.financeSettingsSchema.parse({
        id: 'current',
        tenantId,
        openingBalanceCents: input.openingBalanceCents,
        openingDate: input.openingDate,
        version: (previous?.version ?? 0) + 1,
        updatedAt: now.toISOString(),
        updatedBy: actor.uid,
        schemaVersion: 1,
      });
      tx.set(this.settingsRef(tenantId), next);
      recordAudit(
        this.repo.foundation,
        tx,
        actor,
        tenantId,
        'finance.settings.updated',
        'current',
        next.updatedAt,
        {
          previousOpeningBalanceCents: previous?.openingBalanceCents ?? null,
          openingBalanceCents: next.openingBalanceCents,
          openingDate: next.openingDate,
        },
      );
      return {
        openingBalanceCents: next.openingBalanceCents,
        openingDate: next.openingDate,
        version: next.version,
      };
    });
  }
  /** Balance stated by the company plus what moved since. Null until it is stated. */
  private async cashBalance(env: ManagementEnv) {
    const settings = await this.repo.foundation.read(
      this.settingsRef(env.tenantId),
      s.financeSettingsSchema,
      env.tx,
    );
    if (!settings) return { balanceCents: null, openingDate: null, complete: true };
    try {
      const money = await realizedMoney(env, { from: settings.openingDate, to: env.today });
      return {
        balanceCents:
          settings.openingBalanceCents +
          money.inflows.reduce((a, r) => a + r.cents, 0) -
          money.outflows.reduce((a, r) => a + r.cents, 0),
        openingDate: settings.openingDate,
        complete: true,
      };
    } catch (error) {
      if (error instanceof AppError && error.code === 'REPORT_TOO_LARGE')
        return { balanceCents: null, openingDate: settings.openingDate, complete: false };
      throw error;
    }
  }
  async overview(actor: Actor, tenantId: string, input: z.infer<typeof s.managementQuery>) {
    return this.gate.run(() =>
      this.repo.foundation.db.runTransaction(
        async (tx) => {
          const ctx = await this.commands.access.tenant(
            actor,
            tenantId,
            'financial-dashboard:read',
            tx,
          );
          const today = companyDate(this.commands.clock(), ctx.tenant.timezone);
          const period = {
            from: input.from ?? `${today.slice(0, 8)}01`,
            to: input.to ?? today,
          };
          requireCondition(
            daysBetween(period.from, period.to) < MAX_SPAN_DAYS,
            422,
            'REPORT_RANGE_TOO_LARGE',
            'Período máximo de um ano por consulta',
          );
          const env: ManagementEnv = {
            repo: this.repo,
            tx,
            tenantId,
            timezone: ctx.tenant.timezone,
            today,
          };
          const horizon = Number(input.horizonDays ?? '30');
          const limit = addDays(today, horizon - 1);
          const week = addDays(today, 6);
          const receivables = (
            await this.financial.reportTitles(
              tx,
              tenantId,
              { from: addDays(today, -RECEIVABLE_LOOKBACK_DAYS) },
              RECEIVABLE_CAP,
            )
          ).filter((t) => t.outstandingCents > 0);
          const payables = await openPayables(env);
          const credits = await openSupplierCredits(env);
          const forecast = await recurringForecast(env, limit);
          const realizedRows = await realizedMoney(env, period);
          const cash = await this.cashBalance(env);
          const received = realizedRows.inflows.reduce((a, r) => a + r.cents, 0);
          const paid = realizedRows.outflows.reduce((a, r) => a + r.cents, 0);
          const inFuture = receivables.filter((t) => t.dueDate >= today);
          const outFuture = payables.filter((t) => t.dueDate >= today);
          const total = (rows: { outstandingCents: number }[]) =>
            rows.reduce((a, t) => a + t.outstandingCents, 0);
          const notes = [
            'Títulos não pagos aparecem somente como previsão, nunca como caixa realizado.',
            'Compras de mercadorias entram no resultado pelo custo das mercadorias vendidas, não como despesa.',
            'O resultado estimado é gerencial e não substitui o lucro líquido contábil: não considera tributos, depreciação nem devoluções.',
          ];
          if (!cash.complete)
            notes.push(
              'O saldo de caixa não foi calculado: há lançamentos demais desde a data informada. Informe um saldo mais recente.',
            );
          const profit = await profitability(env, period, this.zonedStart);
          if (profit.ordersWithoutCost > 0)
            notes.push(
              `${profit.ordersWithoutCost} pedido(s) do período não têm custo registrado e ficam fora da margem bruta.`,
            );
          if (profit.undeliveredLossCents > 0)
            notes.push(
              'Mercadorias cobradas e não entregues aparecem em linha própria: reduzem o resultado estimado, mas não o custo das mercadorias vendidas nem a margem bruta.',
            );
          if (profit.bonusesGrantedCents > 0)
            notes.push(
              'Bonificações concedidas aparecem em linha própria: reduzem o resultado estimado, mas não o faturamento, o custo das mercadorias vendidas nem a margem bruta. Retornos ajustam o período da bonificação.',
            );
          if (profit.bonusesWithoutCost > 0)
            notes.push(
              `${profit.bonusesWithoutCost} bonificação(ões) do período não têm custo registrado e ficam fora do resultado estimado.`,
            );
          return s.managementOverview.parse({
            period,
            today,
            receivables: {
              openCents: total(receivables),
              overdueCents: total(receivables.filter((t) => t.dueDate < today)),
              next7DaysCents: total(inFuture.filter((t) => t.dueDate <= week)),
              futureCents: total(inFuture),
              receivedInPeriodCents: received,
            },
            payables: {
              openCents: total(payables),
              overdueCents: total(payables.filter((t) => t.dueDate < today)),
              next7DaysCents: total(outFuture.filter((t) => t.dueDate <= week)),
              futureCents: total(outFuture),
              paidInPeriodCents: paid,
              recurringForecastCents: forecast.reduce((a, r) => a + r.cents, 0),
              supplierCreditsCents: credits.reduce((a, c) => a + c.balanceCents, 0),
            },
            cash: {
              balanceCents: cash.balanceCents,
              openingDate: cash.openingDate,
              periodBalanceCents: received - paid,
            },
            realized: flowByPeriod(period, realizedRows),
            projected: projectedFlow(
              today,
              horizon,
              cash.balanceCents ?? 0,
              inFuture.map((t) => ({ date: t.dueDate, cents: t.outstandingCents })),
              [
                ...outFuture.map((t) => ({ date: t.dueDate, cents: t.outstandingCents })),
                ...forecast,
              ],
            ),
            profitability: profit,
            notes,
          });
        },
        { readOnly: true },
      ),
    );
  }
}
