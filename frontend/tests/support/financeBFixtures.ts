import type {
  CreditApplication,
  CreditLot,
  Payment,
  PaymentCondition,
  PaymentMethod,
  RefundObligation,
} from '@/api/types';
import { method } from './financeFixtures';
const meta = {
  version: 1,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  createdBy: 'u1',
  updatedBy: 'u1',
};
export const lot = (overrides: Partial<CreditLot> = {}): CreditLot => ({
  id: 'l1',
  customerId: 'c1',
  originOrderId: 'origin1',
  originReference: 'origin-event',
  origin: 'order_cancellation',
  issuedCents: 1000,
  availableCents: 750,
  appliedCents: 250,
  version: 6,
  createdAt: meta.createdAt,
  updatedAt: meta.updatedAt,
  ...overrides,
});
export const payment = (overrides: Partial<Payment> = {}): Payment => ({
  id: 'p1',
  orderId: 'o1',
  customerId: 'c1',
  amountCents: 500,
  reversedCents: 100,
  transferredCents: 100,
  allocations: [{ receivableId: 'r1', amountCents: 500, remainingCents: 300 }],
  method,
  receivedOn: '2026-10-01',
  recordedAt: meta.createdAt,
  createdBy: 'u1',
  reference: 'pix-ref',
  version: 8,
  ...overrides,
});
export const application = (overrides: Partial<CreditApplication> = {}): CreditApplication => ({
  id: 'a1',
  orderId: 'o1',
  customerId: 'c1',
  creditLotId: 'l1',
  amountCents: 500,
  reversedCents: 100,
  restoredByCancellationCents: 100,
  allocations: [{ receivableId: 'r1', amountCents: 500, remainingCents: 300 }],
  status: 'active',
  version: 9,
  createdAt: meta.createdAt,
  createdBy: 'u1',
  ...overrides,
});
export const refund = (overrides: Partial<RefundObligation> = {}): RefundObligation => ({
  id: 'f1',
  orderId: 'o1',
  customerId: 'c1',
  originReference: 'origin-event',
  origin: 'order_cancellation',
  originalCents: 700,
  outstandingCents: 500,
  refundedCents: 200,
  version: 10,
  status: 'partially_refunded',
  createdAt: meta.createdAt,
  updatedAt: meta.updatedAt,
  ...overrides,
});
export const condition = (overrides: Partial<PaymentCondition> = {}): PaymentCondition => ({
  ...meta,
  id: 'cond1',
  name: 'Prazo 30 e 60',
  description: 'Prazos empresariais',
  schedule: [
    { offsetDays: 30, weight: 1 },
    { offsetDays: 60, weight: 1 },
  ],
  status: 'active',
  ...overrides,
});
export const settingMethod = (overrides: Partial<PaymentMethod> = {}): PaymentMethod => ({
  ...meta,
  ...method,
  status: 'active',
  ...overrides,
});
