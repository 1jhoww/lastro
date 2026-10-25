import { Router, raw, type Request, type RequestHandler } from 'express';
import { tracked } from './lifecycle.js';
import { z } from 'zod';
import type { AccessService } from '../modules/auth/accessService.js';
import type { UserService } from '../modules/users/userService.js';
import type { PlatformService } from '../modules/platformAdmin/platformService.js';
import type { Permission } from '../modules/users/permissions.js';
import {
  actorFor,
  selectedTenant,
  tenantAuthorization,
  platformAuthorization,
} from '../middlewares/authorization.js';
import { invitationRateLimit } from '../middlewares/rateLimit.js';
import * as s from '../shared/schemas/http.js';
import { AppError } from '../shared/errors/appError.js';
import * as commercial from '../shared/schemas/commercial.js';
import { commercialRoutes } from './commercialRoutes.js';
import type { CustomerService } from '../modules/customers/customerService.js';
import type { ProductService } from '../modules/products/productService.js';
import type { CategoryService } from '../modules/categories/categoryService.js';
import type { ImageService } from '../modules/products/imageService.js';
import { MAX_IMAGE_BYTES } from '../modules/products/imageService.js';
import type { TenantLogoService } from '../modules/tenants/logoService.js';
import { imageRateLimit } from '../middlewares/rateLimit.js';
import { inventoryRoutes } from './inventoryRoutes.js';
import type { InventoryService } from '../modules/inventory/inventoryService.js';
import * as inventorySchemas from '../shared/schemas/inventory.js';
import { orderRoutes } from './orderRoutes.js';
import * as orderSchemas from '../shared/schemas/orders.js';
import type { OrderService } from '../modules/orders/orderService.js';
import { paymentSettingsRoutes } from './paymentSettingsRoutes.js';
import type { PaymentSettingsService } from '../modules/finance/paymentSettingsService.js';
import * as paymentSchemas from '../shared/schemas/paymentSettings.js';
import { financeRoutes } from './financeRoutes.js';
import * as financeSchemas from '../shared/schemas/finance.js';
import type { FinancialService } from '../modules/finance/financialService.js';
import type { FinancialReads } from '../modules/finance/financialReads.js';
import type { ReturnService } from '../modules/returns/returnService.js';
import { returnRoutes } from './returnRoutes.js';
import * as returnSchemas from '../shared/schemas/returns.js';
import { catalogRoutes } from './catalogRoutes.js';
import * as catalogSchemas from '../shared/schemas/catalog.js';
import type { CatalogService } from '../modules/catalog/catalogService.js';
import { documentRoutes } from './documentRoutes.js';
import { reportRoutes } from './reportRoutes.js';
import { visitRoutes } from './visitRoutes.js';
import { VisitService } from '../modules/visits/visitService.js';
import { DeliveryService } from '../modules/orders/deliveryService.js';
import * as visitSchemas from '../shared/schemas/visits.js';
import { ReportService } from '../modules/reports/reportService.js';
import * as reportSchemas from '../shared/schemas/reports.js';
import type { DocumentService } from '../modules/documents/documentService.js';
import type { ExportService } from '../modules/documents/exportService.js';
import { downloadRateLimit } from '../middlewares/rateLimit.js';
import type { Download } from '../modules/documents/download.js';
import { executionRoutes } from './executionRoutes.js';
import { FinancialExecutions } from '../modules/finance/resolution/executionService.js';
import * as executionSchemas from '../modules/finance/resolution/executionModel.js';
import { platformRoutes } from './platformRoutes.js';
import { billingRoutes } from './billingRoutes.js';
import * as billingSchemas from '../shared/schemas/billing.js';
import { BillingService } from '../modules/billing/billingService.js';
import { CompanyService } from '../modules/platformAdmin/companyService.js';
import * as platformSchemas from '../shared/schemas/platform.js';
import { SubscriptionService } from '../modules/platformAdmin/subscriptionService.js';
import { EmailChangeService } from '../modules/users/emailChangeService.js';

export interface Route {
  method: 'get' | 'post' | 'patch' | 'delete' | 'put';
  path: string;
  operationId: string;
  scope: 'identity' | 'invitation' | 'tenant' | 'platform' | 'public';
  permission?: Permission;
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
  output: z.ZodType;
  status?: number;
  executionResponse?: boolean;
  idempotent?: boolean;
  rawImage?: boolean;
  binaryOutput?: boolean;
  downloadType?: 'application/pdf' | 'text/csv';
  description?: string;
}
export const routeDefinitions: Route[] = [
  ...executionRoutes,
  ...documentRoutes,
  ...reportRoutes,
  ...visitRoutes,
  ...catalogRoutes,
  ...financeRoutes,
  ...returnRoutes,
  ...paymentSettingsRoutes,
  ...orderRoutes,
  ...inventoryRoutes,
  ...commercialRoutes,
  ...platformRoutes,
  ...billingRoutes,
  { method: 'get', path: '/me', operationId: 'getMe', scope: 'identity', output: s.meView },
  {
    method: 'patch',
    path: '/me',
    operationId: 'updateMyProfile',
    scope: 'identity',
    body: s.profileInput,
    output: s.meView,
    description:
      'Atualiza somente o nome da própria pessoa autenticada (2 a 80 caracteres, sem e-mail).',
  },
  {
    method: 'get',
    path: '/me/email-change',
    operationId: 'getMyEmailChange',
    scope: 'identity',
    output: s.myEmailChangeView,
    description:
      'Alteração de e-mail da própria conta solicitada pelo suporte e ainda pendente, se houver.',
  },
  {
    method: 'post',
    path: '/me/email-change/complete',
    operationId: 'completeMyEmailChange',
    scope: 'identity',
    output: s.myEmailChangeView,
    description:
      'Conclui a alteração depois que o provedor de identidade aplicou o novo e-mail verificado.',
  },
  {
    method: 'get',
    path: '/tenants/current',
    operationId: 'getCurrentTenant',
    scope: 'tenant',
    permission: 'tenant:read',
    output: s.tenantView,
  },
  {
    method: 'patch',
    path: '/tenants/current',
    operationId: 'updateCurrentTenant',
    scope: 'tenant',
    permission: 'tenant:update',
    body: s.updateTenantInput,
    output: s.tenantView,
    description:
      'Atualiza nome (2 a 120 caracteres) e fuso da empresa ativa, com controle de versão e auditoria.',
  },
  {
    method: 'put',
    path: '/tenants/current/logo',
    operationId: 'uploadCurrentTenantLogo',
    scope: 'tenant',
    permission: 'tenant:update',
    query: s.logoQuery,
    rawImage: true,
    output: s.tenantView,
    description:
      'Envia ou substitui o logotipo (bytes JPEG, PNG ou WebP até 5 MiB). O servidor detecta o formato real, reduz para até 1024 px e grava WebP privado da empresa; o logotipo anterior é apagado.',
  },
  {
    method: 'get',
    path: '/tenants/current/logo',
    operationId: 'getCurrentTenantLogo',
    scope: 'tenant',
    permission: 'tenant:read',
    binaryOutput: true,
    output: s.tenantLogoView,
    description: 'Bytes WebP do logotipo da empresa ativa (somente com sessão e empresa).',
  },
  {
    method: 'delete',
    path: '/tenants/current/logo',
    operationId: 'removeCurrentTenantLogo',
    scope: 'tenant',
    permission: 'tenant:update',
    query: s.logoQuery,
    output: s.tenantView,
    description: 'Remove o logotipo; documentos voltam a mostrar só o nome da empresa.',
  },
  {
    method: 'get',
    path: '/users',
    operationId: 'listUsers',
    scope: 'tenant',
    permission: 'users:manage',
    query: s.pageQuery,
    output: s.usersView,
  },
  {
    method: 'post',
    path: '/users/invitations',
    operationId: 'inviteUser',
    scope: 'tenant',
    permission: 'users:manage',
    body: s.inviteInput,
    output: s.issuedInvitationView,
    status: 201,
  },
  {
    method: 'post',
    path: '/users/invitations/accept',
    operationId: 'acceptInvitation',
    scope: 'invitation',
    body: s.acceptInput,
    output: s.acceptedView,
  },
  {
    method: 'post',
    path: '/users/invitations/:id/revoke',
    operationId: 'revokeInvitation',
    scope: 'tenant',
    permission: 'users:manage',
    params: s.idParams,
    output: s.revokedView,
  },
  {
    method: 'post',
    path: '/users/invitations/:id/reissue',
    operationId: 'reissueInvitation',
    scope: 'tenant',
    permission: 'users:manage',
    params: s.idParams,
    body: s.reissueInvitationInput,
    output: s.issuedInvitationView,
    status: 201,
    description:
      'Reenvia um convite pendente com novo link (o anterior deixa de valer) ou corrige o e-mail, sem ocupar outra vaga.',
  },
  {
    method: 'patch',
    path: '/users/:id/permissions',
    operationId: 'updateUserPermissions',
    scope: 'tenant',
    permission: 'users:manage',
    params: s.idParams,
    body: s.operationsInput,
    output: s.memberView,
    description:
      'Define as operações de um vendedor dentro da matriz de permissões; operações administrativas são sempre recusadas.',
  },
  {
    method: 'patch',
    path: '/users/:id/role',
    operationId: 'updateUserRole',
    scope: 'tenant',
    permission: 'users:manage',
    params: s.idParams,
    body: s.roleInput,
    output: s.memberView,
  },
  {
    method: 'patch',
    path: '/users/:id/status',
    operationId: 'updateUserStatus',
    scope: 'tenant',
    permission: 'users:manage',
    params: s.idParams,
    body: s.statusInput,
    output: s.memberView,
  },
  {
    method: 'get',
    path: '/admin/tenants',
    operationId: 'listTenants',
    scope: 'platform',
    query: s.pageQuery,
    output: s.pageOf(s.tenantView),
  },
  {
    method: 'post',
    path: '/admin/tenants',
    operationId: 'createTenant',
    scope: 'platform',
    body: s.createTenantInput,
    output: s.createdTenantView,
    status: 201,
    idempotent: true,
  },
  {
    method: 'post',
    path: '/admin/tenants/:id/owner-invitations',
    operationId: 'renewOwnerInvitation',
    scope: 'platform',
    params: s.idParams,
    body: s.ownerInviteInput,
    output: s.issuedInvitationView,
    status: 201,
    idempotent: true,
  },
  {
    method: 'get',
    path: '/admin/plans',
    operationId: 'listPlans',
    scope: 'platform',
    query: s.pageQuery,
    output: s.pageOf(s.planView),
    description:
      'Planos personalizados anteriores ao catálogo oficial (somente leitura). Planos oficiais: /admin/plan-catalog.',
  },
  {
    method: 'get',
    path: '/admin/subscriptions',
    operationId: 'listSubscriptions',
    scope: 'platform',
    query: s.pageQuery,
    output: s.pageOf(s.subscriptionView),
  },
];

const limitFor = (req: Request) => Number(s.pageQuery.parse(req.query).limit ?? '25');
const cursorFor = (req: Request) => s.pageQuery.parse(req.query).cursor;
const idFor = (req: Request) => s.idParams.parse(req.params).id;
function idempotencyKey(req: Request): string {
  const result = z.string().uuid().safeParse(req.headers['idempotency-key']);
  if (!result.success)
    throw new AppError(422, 'VALIDATION_ERROR', 'Idempotency-Key UUID obrigatório');
  return result.data;
}
export function createRoutes(
  access: AccessService,
  users: UserService,
  platform: PlatformService,
  clock: () => Date,
  customers: CustomerService,
  products: ProductService,
  categories: CategoryService,
  images: ImageService,
  inventory: InventoryService,
  orders: OrderService,
  paymentSettings: PaymentSettingsService,
  finance: FinancialService,
  financialReads: FinancialReads,
  returns: ReturnService,
  catalog: CatalogService,
  documents: DocumentService,
  exports: ExportService,
  logos: TenantLogoService,
): Router {
  const router = Router();
  const executions = new FinancialExecutions(finance, returns);
  const subscriptions = new SubscriptionService(platform.repo, platform.access, clock);
  const billing = new BillingService(platform.repo, platform.access, platform.config, clock);
  const emailChanges = new EmailChangeService(platform.repo, platform.access, users.auth, clock);
  const companies = new CompanyService(
    platform.repo,
    platform.access,
    users.auth,
    platform.config,
    clock,
    emailChanges,
  );
  const reports = new ReportService(orders, financialReads, inventory, users.auth, logos);
  const visits = new VisitService(orders, users.auth);
  const deliveries = new DeliveryService(orders);
  const reportFor = (req: Request) => reportSchemas.reportParams.parse(req.params).report;
  const handlers: Record<string, (req: Request) => Promise<unknown>> = {
    listVisits: (req) =>
      visits.list(actorFor(req), selectedTenant(req), visitSchemas.visitQuery.parse(req.query)),
    createVisit: (req) =>
      visits.create(
        actorFor(req),
        selectedTenant(req),
        visitSchemas.visitCreate.parse(req.body),
        idempotencyKey(req),
      ),
    listRepurchase: (req) =>
      visits.repurchase(
        actorFor(req),
        selectedTenant(req),
        visitSchemas.repurchaseQuery.parse(req.query),
      ),
    getCustomerRepurchase: (req) =>
      visits.customerRepurchase(actorFor(req), selectedTenant(req), idFor(req)),
    getCustomerTimeline: (req) =>
      visits.timeline(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        visitSchemas.timelineQuery.parse(req.query),
      ),
    getOrderDelivery: (req) => deliveries.get(actorFor(req), selectedTenant(req), idFor(req)),
    confirmOrderDelivery: (req) =>
      deliveries.confirm(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        visitSchemas.deliveryInput.parse(req.body),
      ),
    getReport: (req) =>
      reports.report(actorFor(req), selectedTenant(req), reportFor(req), req.query),
    exportReportCsv: (req) =>
      reports.download(actorFor(req), selectedTenant(req), reportFor(req), req.query, 'csv'),
    exportReportPdf: (req) =>
      reports.download(actorFor(req), selectedTenant(req), reportFor(req), req.query, 'pdf'),
    startFinancialCancellationExecution: (req) =>
      executions.startCancellation(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        financeSchemas.cancellationInput.parse(req.body),
        idempotencyKey(req),
      ),
    startReturnResolutionExecution: (req) =>
      executions.startReturn(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        returnSchemas.returnResolve.parse(req.body),
        idempotencyKey(req),
      ),
    getFinancialExecution: (req) => executions.get(actorFor(req), selectedTenant(req), idFor(req)),
    listFinancialExecutions: (req) =>
      executions.list(
        actorFor(req),
        selectedTenant(req),
        executionSchemas.executionsQuery.parse(req.query),
      ),
    advanceFinancialExecution: (req) =>
      executions.advance(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        executionSchemas.advanceInput.parse(req.body),
        idempotencyKey(req),
      ),
    resumeFinancialExecution: (req) =>
      executions.control(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        executionSchemas.resumeInput.parse(req.body),
        idempotencyKey(req),
      ),
    abortFinancialExecution: (req) =>
      executions.control(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        executionSchemas.abortInput.parse(req.body),
        idempotencyKey(req),
        true,
      ),
    reconcileFinancialExecutionProofs: (req) =>
      executions.reconcile(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        limitFor(req),
        cursorFor(req),
      ),
    downloadCommercialOrder: (req) =>
      documents.download(actorFor(req), selectedTenant(req), idFor(req), 'commercial'),
    downloadPackingOrder: (req) =>
      documents.download(actorFor(req), selectedTenant(req), idFor(req), 'packing'),
    exportCustomers: (req) =>
      exports.download(actorFor(req), selectedTenant(req), 'customers', req.query),
    exportProducts: (req) =>
      exports.download(actorFor(req), selectedTenant(req), 'products', req.query),
    exportOrders: (req) =>
      exports.download(actorFor(req), selectedTenant(req), 'orders', req.query),
    exportReceivables: (req) =>
      exports.download(actorFor(req), selectedTenant(req), 'receivables', req.query),
    getCatalogSettings: (req) => catalog.adminGet(actorFor(req), selectedTenant(req)),
    configureCatalog: (req) =>
      catalog.configure(
        actorFor(req),
        selectedTenant(req),
        catalogSchemas.catalogConfigure.parse(req.body),
        idempotencyKey(req),
      ),
    createReturn: (req) =>
      returns.create(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        returnSchemas.returnCreate.parse(req.body),
        idempotencyKey(req),
      ),
    getReturn: (req) => returns.get(actorFor(req), selectedTenant(req), idFor(req)),
    previewReturnResolution: (req) =>
      returns.resolutionPreview(actorFor(req), selectedTenant(req), idFor(req)),
    listReturns: (req) =>
      returns.list(actorFor(req), selectedTenant(req), returnSchemas.returnsQuery.parse(req.query)),
    editReturn: (req) =>
      returns.update(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        returnSchemas.returnUpdate.parse(req.body),
        idempotencyKey(req),
      ),
    cancelReturnPending: (req) =>
      returns.cancel(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        returnSchemas.returnCancel.parse(req.body),
        idempotencyKey(req),
      ),
    receiveReturn: (req) =>
      returns.receive(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        returnSchemas.returnReceive.parse(req.body),
        idempotencyKey(req),
      ),
    resolveReturn: (req) =>
      returns.resolve(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        returnSchemas.returnResolve.parse(req.body),
        idempotencyKey(req),
      ),
    getReturnHistory: (req) =>
      returns.list(
        actorFor(req),
        selectedTenant(req),
        s.pageQuery.parse(req.query),
        idFor(req),
        'returnEvents',
      ),
    getReturnReceipts: (req) =>
      returns.list(
        actorFor(req),
        selectedTenant(req),
        s.pageQuery.parse(req.query),
        idFor(req),
        'returnReceipts',
      ),
    getFinancialState: (req) =>
      financialReads.state(actorFor(req), selectedTenant(req), idFor(req)),
    reversePayment: (req) =>
      finance.paymentReversal(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        financeSchemas.reversalInput.parse(req.body),
        idempotencyKey(req),
      ),
    listCustomerCredits: (req) =>
      financialReads.list(actorFor(req), selectedTenant(req), 'creditLots', {
        ...s.pageQuery.parse(req.query),
        customerId: idFor(req),
      }),
    listCreditApplications: (req) =>
      financialReads.list(
        actorFor(req),
        selectedTenant(req),
        'creditApplications',
        financeSchemas.financialQuery.parse(req.query),
      ),
    getCreditApplication: (req) =>
      financialReads.resource(actorFor(req), selectedTenant(req), 'creditApplications', idFor(req)),
    applyOrderCredit: (req) =>
      finance.creditApplication(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        financeSchemas.creditInput.parse(req.body),
        idempotencyKey(req),
      ),
    reverseOrderCredit: (req) =>
      finance.creditReversal(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        financeSchemas.creditReversalInput.parse(req.body),
        idempotencyKey(req),
      ),
    changeReceivableDueDate: (req) =>
      finance.changeDueDate(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        financeSchemas.dueDateChangeInput.parse(req.body),
        idempotencyKey(req),
      ),
    listReceivableDueDateChanges: (req) =>
      financialReads.dueDateChanges(actorFor(req), selectedTenant(req), idFor(req)),
    cancelOrderFinancially: (req) =>
      finance.cancel(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        financeSchemas.cancellationInput.parse(req.body),
        idempotencyKey(req),
      ),
    listRefundObligations: (req) =>
      financialReads.list(
        actorFor(req),
        selectedTenant(req),
        'refundObligations',
        financeSchemas.financialQuery.parse(req.query),
      ),
    getRefundObligation: (req) =>
      financialReads.resource(actorFor(req), selectedTenant(req), 'refundObligations', idFor(req)),
    getRefundConfirmation: (req) =>
      financialReads.resource(
        actorFor(req),
        selectedTenant(req),
        'refundConfirmations',
        idFor(req),
      ),
    confirmManualRefund: (req) =>
      finance.refund(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        financeSchemas.refundInput.parse(req.body),
        idempotencyKey(req),
      ),
    listReceivables: (req) =>
      financialReads.titles(
        actorFor(req),
        selectedTenant(req),
        financeSchemas.titleQuery.parse(req.query),
      ),
    getReceivable: (req) => financialReads.title(actorFor(req), selectedTenant(req), idFor(req)),
    listPayments: (req) =>
      financialReads.list(
        actorFor(req),
        selectedTenant(req),
        'payments',
        financeSchemas.financialQuery.parse(req.query),
      ),
    getPayment: (req) => financialReads.payment(actorFor(req), selectedTenant(req), idFor(req)),
    receiveOrderPayment: (req) =>
      finance.receipt(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        financeSchemas.receiptInput.parse(req.body),
        idempotencyKey(req),
      ),
    getFinancialHistory: (req) =>
      financialReads.history(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        s.pageQuery.parse(req.query),
      ),
    reconcileFinancialOrder: (req) =>
      financialReads.history(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        s.pageQuery.parse(req.query),
        true,
      ),
    listConditionOptions: (req) =>
      paymentSettings.list(
        actorFor(req),
        selectedTenant(req),
        'condition',
        s.pageQuery.parse(req.query),
        true,
      ),
    listMethodOptions: (req) =>
      paymentSettings.list(
        actorFor(req),
        selectedTenant(req),
        'method',
        s.pageQuery.parse(req.query),
        true,
      ),
    previewOrderPayment: (req) =>
      orders.paymentPreview(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        orderSchemas.paymentPreviewInput.parse(req.body),
      ),
    listPaymentConditions: (req) =>
      paymentSettings.list(
        actorFor(req),
        selectedTenant(req),
        'condition',
        paymentSchemas.settingsQuery.parse(req.query),
      ),
    listPaymentMethods: (req) =>
      paymentSettings.list(
        actorFor(req),
        selectedTenant(req),
        'method',
        paymentSchemas.settingsQuery.parse(req.query),
      ),
    createPaymentCondition: (req) =>
      paymentSettings.createCondition(
        actorFor(req),
        selectedTenant(req),
        paymentSchemas.conditionCreate.parse(req.body),
        idempotencyKey(req),
      ),
    createPaymentMethod: (req) =>
      paymentSettings.createMethod(
        actorFor(req),
        selectedTenant(req),
        paymentSchemas.methodCreate.parse(req.body),
        idempotencyKey(req),
      ),
    getPaymentCondition: (req) =>
      paymentSettings.read(actorFor(req), selectedTenant(req), 'condition', idFor(req)),
    getPaymentMethod: (req) =>
      paymentSettings.read(actorFor(req), selectedTenant(req), 'method', idFor(req)),
    updatePaymentCondition: (req) =>
      paymentSettings.updateCondition(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        paymentSchemas.conditionUpdate.parse(req.body),
        idempotencyKey(req),
      ),
    updatePaymentMethod: (req) =>
      paymentSettings.updateMethod(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        paymentSchemas.methodUpdate.parse(req.body),
        idempotencyKey(req),
      ),
    listOrders: (req) =>
      orders.list(actorFor(req), selectedTenant(req), orderSchemas.orderQuery.parse(req.query)),
    createOrder: (req) =>
      orders.create(actorFor(req), selectedTenant(req), orderSchemas.orderCreate.parse(req.body)),
    getOrder: (req) => orders.read(actorFor(req), selectedTenant(req), idFor(req)),
    updateOrder: (req) =>
      orders.update(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        orderSchemas.orderUpdate.parse(req.body),
      ),
    confirmOrder: (req) =>
      orders.command(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        'confirm',
        orderSchemas.orderCommand.parse(req.body),
        idempotencyKey(req),
      ),
    dispatchOrder: (req) =>
      orders.command(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        'dispatch',
        orderSchemas.orderCommand.parse(req.body),
        idempotencyKey(req),
      ),
    cancelOrder: (req) =>
      orders.command(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        'cancel',
        orderSchemas.cancelCommand.parse(req.body),
        idempotencyKey(req),
      ),
    getOrderHistory: (req) =>
      orders.history(actorFor(req), selectedTenant(req), idFor(req), s.pageQuery.parse(req.query)),
    getInventorySummary: (req) => inventory.summary(actorFor(req), selectedTenant(req)),
    listInventory: (req) =>
      inventory.list(
        actorFor(req),
        selectedTenant(req),
        inventorySchemas.inventoryQuery.parse(req.query),
      ),
    getInventory: (req) =>
      inventory.get(
        actorFor(req),
        selectedTenant(req),
        inventorySchemas.inventoryParams.parse(req.params).productId,
      ),
    listStockMovements: (req) =>
      inventory.movements(
        actorFor(req),
        selectedTenant(req),
        inventorySchemas.movementQuery.parse(req.query),
      ),
    listReplenishment: (req) =>
      inventory.replenishment(
        actorFor(req),
        selectedTenant(req),
        inventorySchemas.replenishmentQuery.parse(req.query),
      ),
    createStockEntry: (req) =>
      inventory.entry(
        actorFor(req),
        selectedTenant(req),
        inventorySchemas.entryInput.parse(req.body),
        idempotencyKey(req),
      ),
    createStockAdjustment: (req) =>
      inventory.adjust(
        actorFor(req),
        selectedTenant(req),
        inventorySchemas.adjustmentInput.parse(req.body),
        idempotencyKey(req),
      ),
    reconcileStock: (req) =>
      inventory.reconcile(
        actorFor(req),
        selectedTenant(req),
        inventorySchemas.inventoryParams.parse(req.params).productId,
        s.pageQuery.parse(req.query),
      ),
    listCustomers: (req) =>
      customers.list(actorFor(req), selectedTenant(req), commercial.customerQuery.parse(req.query)),
    createCustomer: (req) =>
      customers.create(
        actorFor(req),
        selectedTenant(req),
        commercial.customerCreate.parse(req.body),
      ),
    getCustomer: (req) => customers.read(actorFor(req), selectedTenant(req), idFor(req)),
    updateCustomer: (req) =>
      customers.update(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        commercial.customerUpdate.parse(req.body),
      ),
    deactivateCustomer: (req) =>
      customers.update(actorFor(req), selectedTenant(req), idFor(req), {
        ...commercial.versionInput.parse(req.body),
        status: 'inactive',
      }),
    assignCustomer: (req) =>
      customers.assign(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        commercial.assignmentInput.parse(req.body),
      ),
    listProducts: (req) =>
      products.list(actorFor(req), selectedTenant(req), commercial.productQuery.parse(req.query)),
    createProduct: (req) =>
      products.create(actorFor(req), selectedTenant(req), commercial.productCreate.parse(req.body)),
    getProduct: (req) => products.read(actorFor(req), selectedTenant(req), idFor(req)),
    updateProduct: (req) =>
      products.update(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        commercial.productUpdate.parse(req.body),
      ),
    deactivateProduct: (req) =>
      products.update(actorFor(req), selectedTenant(req), idFor(req), {
        ...commercial.versionInput.parse(req.body),
        status: 'inactive',
      }),
    uploadProductImage: (req) =>
      images.upload(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        Number(commercial.imageQuery.parse(req.query).expectedVersion),
        req.body,
        req.get('Content-Type'),
      ),
    getProductImage: (req) => images.download(actorFor(req), selectedTenant(req), idFor(req)),
    removeProductImage: (req) =>
      images.remove(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        Number(commercial.imageQuery.parse(req.query).expectedVersion),
      ),
    listCategories: (req) =>
      categories.list(
        actorFor(req),
        selectedTenant(req),
        commercial.categoryQuery.parse(req.query),
      ),
    createCategory: (req) =>
      categories.create(
        actorFor(req),
        selectedTenant(req),
        commercial.categoryCreate.parse(req.body),
      ),
    getCategory: (req) => categories.read(actorFor(req), selectedTenant(req), idFor(req)),
    updateCategory: (req) =>
      categories.update(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        commercial.categoryUpdate.parse(req.body),
      ),
    deactivateCategory: (req) =>
      categories.update(actorFor(req), selectedTenant(req), idFor(req), {
        ...commercial.versionInput.parse(req.body),
        status: 'inactive',
      }),
    getMe: (req) => users.me(actorFor(req)),
    updateMyProfile: (req) => users.updateProfile(actorFor(req), s.profileInput.parse(req.body)),
    getCurrentTenant: (req) => users.current(actorFor(req), selectedTenant(req)),
    updateCurrentTenant: (req) =>
      users.updateTenant(actorFor(req), selectedTenant(req), s.updateTenantInput.parse(req.body)),
    uploadCurrentTenantLogo: (req) =>
      logos.upload(
        actorFor(req),
        selectedTenant(req),
        Number(s.logoQuery.parse(req.query).expectedVersion),
        req.body,
        req.get('Content-Type'),
      ),
    getCurrentTenantLogo: (req) => logos.download(actorFor(req), selectedTenant(req)),
    removeCurrentTenantLogo: (req) =>
      logos.remove(
        actorFor(req),
        selectedTenant(req),
        Number(s.logoQuery.parse(req.query).expectedVersion),
      ),
    listUsers: (req) =>
      users.list(actorFor(req), selectedTenant(req), limitFor(req), cursorFor(req)),
    inviteUser: (req) =>
      users.invite(actorFor(req), selectedTenant(req), s.inviteInput.parse(req.body)),
    acceptInvitation: (req) => users.accept(actorFor(req), s.acceptInput.parse(req.body).token),
    revokeInvitation: (req) =>
      users.revokeInvitation(actorFor(req), selectedTenant(req), idFor(req)),
    reissueInvitation: (req) =>
      users.reissue(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        s.reissueInvitationInput.parse(req.body),
      ),
    updateUserPermissions: (req) =>
      users.updateOperations(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        s.operationsInput.parse(req.body),
      ),
    getMyEmailChange: (req) => emailChanges.mine(actorFor(req)),
    completeMyEmailChange: (req) => emailChanges.complete(actorFor(req)),
    updateUserRole: (req) =>
      users.updateMember(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        s.roleInput.parse(req.body),
      ),
    updateUserStatus: (req) =>
      users.updateMember(
        actorFor(req),
        selectedTenant(req),
        idFor(req),
        s.statusInput.parse(req.body),
      ),
    listTenants: (req) => platform.list(actorFor(req), 'tenants', limitFor(req), cursorFor(req)),
    createTenant: (req) =>
      platform.createTenant(
        actorFor(req),
        s.createTenantInput.parse(req.body),
        idempotencyKey(req),
      ),
    renewOwnerInvitation: (req) =>
      platform.renewOwnerInvitation(
        actorFor(req),
        idFor(req),
        s.ownerInviteInput.parse(req.body),
        idempotencyKey(req),
      ),
    listPlans: (req) => platform.list(actorFor(req), 'plans', limitFor(req), cursorFor(req)),
    listSubscriptions: (req) =>
      platform.list(actorFor(req), 'subscriptions', limitFor(req), cursorFor(req)),
    getPlanCatalog: (req) => subscriptions.catalog(actorFor(req)),
    previewPlanChange: (req) =>
      subscriptions.previewPlanChange(
        actorFor(req),
        idFor(req),
        s.planChangeQuery.parse(req.query).planCode,
      ),
    changeSubscriptionPlan: (req) =>
      subscriptions.changePlan(actorFor(req), idFor(req), s.changePlanInput.parse(req.body)),
    activateSubscription: (req) =>
      subscriptions.activate(
        actorFor(req),
        idFor(req),
        s.activateSubscriptionInput.parse(req.body),
      ),
    updateSubscriptionTerms: (req) =>
      subscriptions.updateTerms(
        actorFor(req),
        idFor(req),
        s.subscriptionTermsInput.parse(req.body),
      ),
    suspendSubscription: (req) =>
      subscriptions.suspend(actorFor(req), idFor(req), s.subscriptionCommandInput.parse(req.body)),
    reactivateSubscription: (req) =>
      subscriptions.reactivate(
        actorFor(req),
        idFor(req),
        s.subscriptionCommandInput.parse(req.body),
      ),
    getSubscriptionHistory: (req) => subscriptions.history(actorFor(req), idFor(req)),
    listCharges: (req) =>
      billing.list(actorFor(req), billingSchemas.chargeListQuery.parse(req.query)),
    createCharge: (req) =>
      billing.create(actorFor(req), billingSchemas.createChargeInput.parse(req.body)),
    generateCharges: (req) => billing.generateNow(actorFor(req)),
    payCharge: (req) =>
      billing.pay(actorFor(req), idFor(req), billingSchemas.payChargeInput.parse(req.body)),
    correctCharge: (req) =>
      billing.correct(actorFor(req), idFor(req), billingSchemas.correctChargeInput.parse(req.body)),
    cancelCharge: (req) =>
      billing.cancel(actorFor(req), idFor(req), billingSchemas.cancelChargeInput.parse(req.body)),
    getChargeHistory: (req) => billing.history(actorFor(req), idFor(req)),
    getPlatformOverview: (req) => companies.overview(actorFor(req)),
    listCompanies: (req) =>
      companies.companies(actorFor(req), platformSchemas.companyQuery.parse(req.query)),
    getCompany: (req) => companies.company(actorFor(req), idFor(req)),
    revokeCompanyInvitation: (req) => {
      const params = platformSchemas.companyInvitationParams.parse(req.params);
      return companies.revokeInvitation(
        actorFor(req),
        params.id,
        params.invitationId,
        platformSchemas.revokeInvitationInput.parse(req.body).reason,
      );
    },
    listOwnerInvitations: (req) => companies.ownerInvitations(actorFor(req)),
    createCompanyInvitation: (req) =>
      users.platformInvite(
        actorFor(req),
        idFor(req),
        platformSchemas.companyInviteInput.parse(req.body),
      ),
    reissueCompanyInvitation: (req) => {
      const params = platformSchemas.companyInvitationParams.parse(req.params);
      return users.platformReissue(
        actorFor(req),
        params.id,
        params.invitationId,
        platformSchemas.companyReissueInput.parse(req.body),
      );
    },
    updateCompanyMemberStatus: (req) => {
      const params = platformSchemas.companyMemberParams.parse(req.params);
      return users.platformMemberStatus(
        actorFor(req),
        params.id,
        params.uid,
        platformSchemas.companyMemberStatusInput.parse(req.body),
      );
    },
    unblockCompanyMemberAccount: (req) => {
      const params = platformSchemas.companyMemberParams.parse(req.params);
      return users.platformUnblockAccount(
        actorFor(req),
        params.id,
        params.uid,
        platformSchemas.revokeInvitationInput.parse(req.body).reason,
      );
    },
    requestEmailChange: (req) => {
      const params = platformSchemas.companyMemberParams.parse(req.params);
      const input = platformSchemas.emailChangeInput.parse(req.body);
      return emailChanges.start(actorFor(req), params.id, params.uid, input.newEmail, input.reason);
    },
    cancelEmailChange: (req) => {
      const params = platformSchemas.companyMemberParams.parse(req.params);
      return emailChanges.cancel(
        actorFor(req),
        params.id,
        params.uid,
        platformSchemas.emailChangeCancelInput.parse(req.body).reason,
      );
    },
  };
  for (const definition of routeDefinitions) {
    if (definition.scope === 'public') continue;
    const middleware: RequestHandler[] = [];
    if (definition.scope === 'tenant') {
      if (!definition.permission) throw new Error('Rota privada sem permissão');
      middleware.push(tenantAuthorization(access, definition.permission));
    } else if (definition.scope === 'platform')
      middleware.push(platformAuthorization(access, clock));
    if (
      definition.scope === 'invitation' ||
      definition.operationId === 'inviteUser' ||
      definition.operationId === 'reissueInvitation'
    )
      middleware.push(invitationRateLimit(users.repo));
    if (definition.rawImage)
      middleware.push(
        imageRateLimit(users.repo),
        raw({ type: '*/*', limit: MAX_IMAGE_BYTES, inflate: false }),
      );
    if (definition.downloadType) middleware.push(downloadRateLimit(users.repo));
    const handler = handlers[definition.operationId];
    if (!handler) throw new Error('Rota sem implementação');
    router[definition.method](
      definition.path,
      ...middleware.map(tracked),
      tracked(async (req, res) => {
        (definition.query ?? s.empty).parse(req.query);
        (definition.params ?? s.empty).parse(req.params);
        if (definition.body) definition.body.parse(req.body);
        else if (!definition.rawImage && req.body !== undefined) s.empty.parse(req.body);
        const result = await handler(req);
        // Deadline/disconnect does not cancel a financial commit or invalidate its replay record.
        if (res.writableEnded || res.destroyed) return;
        if (definition.downloadType) {
          const download = result as Download;
          if (
            !Buffer.isBuffer(download.bytes) ||
            !/^[a-zA-Z0-9_-]+\.(pdf|csv)$/.test(download.filename)
          )
            throw new AppError(500, 'INTERNAL_ERROR', 'Erro interno do servidor');
          res
            .type(definition.downloadType)
            .set('Cache-Control', 'private, no-store')
            .set('Content-Disposition', `attachment; filename="${download.filename}"`)
            .set('X-Content-Type-Options', 'nosniff');
          if (download.nextCursor) res.set('X-Next-Cursor', download.nextCursor);
          if (download.rowCount !== undefined)
            res.set('X-Export-Row-Count', String(download.rowCount));
          res.send(download.bytes);
          return;
        }
        if (definition.binaryOutput) {
          if (!Buffer.isBuffer(result))
            throw new AppError(500, 'INTERNAL_ERROR', 'Erro interno do servidor');
          res
            .type('image/webp')
            .set('Cache-Control', 'private, no-store')
            .set('Content-Disposition', 'inline; filename="image.webp"')
            .send(result);
          return;
        }
        const data = definition.output.parse(result);
        const status = definition.executionResponse
          ? executionSchemas.executionView.parse(data).financialCompleted ||
            executionSchemas.executionView.parse(data).status === 'ABORTED'
            ? 200
            : 202
          : (definition.status ?? 200);
        res.status(status).json({ data, requestId: req.requestId });
      }),
    );
  }
  return router;
}
