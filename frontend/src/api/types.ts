import type { paths } from './schema';

export type ReturnCreateInput = BodyOf<'/api/v1/orders/{id}/returns', 'post'>;
export type ReturnReceiveInput = BodyOf<'/api/v1/returns/{id}/receipts', 'post'>;
export type ReturnCancelInput = BodyOf<'/api/v1/returns/{id}/cancel-pending', 'post'>;
export type ReturnUpdateInput = BodyOf<'/api/v1/returns/{id}', 'patch'>;

export type CatalogSettings = DataOf<'/api/v1/catalog-settings', 'put'>;
export type CatalogInput = BodyOf<'/api/v1/catalog-settings', 'put'>;
export type PublicCatalog = DataOf<'/api/v1/public/catalogs/{slug}', 'get'>;
export type PublicProducts = DataOf<'/api/v1/public/catalogs/{slug}/products', 'get'>;
export type PublicProduct = PublicProducts['items'][number];
export type QuoteInput = BodyOf<'/api/v1/public/catalogs/{slug}/quote-preview', 'post'>;
export type QuotePreview = DataOf<'/api/v1/public/catalogs/{slug}/quote-preview', 'post'>;
export type WhatsappQuote = DataOf<'/api/v1/public/catalogs/{slug}/whatsapp', 'post'>;

/** Corpo `data` da resposta 200/201 de uma operação do contrato. */
type DataOf<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: infer R;
}
  ? R extends { 200: { content: { 'application/json': { data: infer D } } } }
    ? D
    : R extends { 201: { content: { 'application/json': { data: infer D } } } }
      ? D
      : never
  : never;

export type Me = DataOf<'/api/v1/me', 'get'>;
export type Membership = Me['memberships'][number];
export type MembershipAccess = Membership['access'];
export type Role = Membership['role'];

export type Tenant = DataOf<'/api/v1/tenants/current', 'get'>;
export type UsersPage = DataOf<'/api/v1/users', 'get'>;
export type Member = UsersPage['items'][number];
export type PendingInvitation = UsersPage['pendingInvitations'][number];
export type IssuedInvitation = DataOf<'/api/v1/users/invitations', 'post'>;
export type AcceptedInvitation = DataOf<'/api/v1/users/invitations/accept', 'post'>;

export type TenantsPage = DataOf<'/api/v1/admin/tenants', 'get'>;
export type CreatedTenant = DataOf<'/api/v1/admin/tenants', 'post'>;
export type PlansPage = DataOf<'/api/v1/admin/plans', 'get'>;
export type Plan = PlansPage['items'][number];
export type SubscriptionsPage = DataOf<'/api/v1/admin/subscriptions', 'get'>;
export type Subscription = SubscriptionsPage['items'][number];
export type SubscriptionStatus = Subscription['status'];
export type MembershipPlan = Membership['plan'];
export type PlanCode = NonNullable<MembershipPlan['code']>;
export type PlanFeature = MembershipPlan['features'][number];

export type PlatformOverview = DataOf<'/api/v1/admin/overview', 'get'>;
export type CompanyList = DataOf<'/api/v1/admin/companies', 'get'>;
export type CompanyRow = CompanyList['items'][number];
export type CompanyDetail = DataOf<'/api/v1/admin/companies/{id}', 'get'>;
export type CompanySubscription = CompanyDetail['subscription'];
export type PlanCatalog = DataOf<'/api/v1/admin/plan-catalog', 'get'>;
export type PlanChangePreview = DataOf<'/api/v1/admin/subscriptions/{id}/plan-change', 'get'>;
export type HistoryEntry = DataOf<
  '/api/v1/admin/subscriptions/{id}/history',
  'get'
>['items'][number];
export type ChargePage = DataOf<'/api/v1/admin/charges', 'get'>;
export type Charge = ChargePage['items'][number];
export type ChargeSituation = Charge['situation'];
export type GenerationResult = DataOf<'/api/v1/admin/charges/generate', 'post'>;
export type OwnerInvitations = DataOf<'/api/v1/admin/invitations', 'get'>;
export type OwnerInvitationRow = OwnerInvitations['items'][number];

type BodyOf<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  requestBody?: { content: { 'application/json': infer B } };
}
  ? B
  : never;

export type CustomersPage = DataOf<'/api/v1/customers', 'get'>;
export type Customer = DataOf<'/api/v1/customers/{id}', 'get'>;
export type CustomerCreate = BodyOf<'/api/v1/customers', 'post'>;
export type CustomerUpdate = BodyOf<'/api/v1/customers/{id}', 'patch'>;
export type CustomerAddress = NonNullable<Customer['address']>;

export type ProductsPage = DataOf<'/api/v1/products', 'get'>;
export type Product = DataOf<'/api/v1/products/{id}', 'get'>;
export type ProductCreate = BodyOf<'/api/v1/products', 'post'>;
export type ProductUpdate = BodyOf<'/api/v1/products/{id}', 'patch'>;
export type ProductUnit = Product['unit'];

export type CategoriesPage = DataOf<'/api/v1/categories', 'get'>;
export type Category = DataOf<'/api/v1/categories/{id}', 'get'>;
export type CategoryCreate = BodyOf<'/api/v1/categories', 'post'>;
export type CategoryUpdate = BodyOf<'/api/v1/categories/{id}', 'patch'>;

/** Saldo: administrador recebe a visão completa; vendedor, só o disponível. */
export type InventoryItem = DataOf<'/api/v1/inventory/{productId}', 'get'>;
export type InventoryPage = DataOf<'/api/v1/inventory', 'get'>;
export type StockAdmin = DataOf<'/api/v1/inventory/replenishment', 'get'>['items'][number];
export type StockAvailability = Exclude<InventoryItem, StockAdmin>;
export type MovementsPage = DataOf<'/api/v1/inventory/movements', 'get'>;
export type Movement = MovementsPage['items'][number];
export type MovementType = Movement['type'];
export type MovementResult = DataOf<'/api/v1/inventory/entries', 'post'>;
export type StockEntryBody = BodyOf<'/api/v1/inventory/entries', 'post'>;
export type StockAdjustmentBody = BodyOf<'/api/v1/inventory/adjustments', 'post'>;

/* Pedidos */
export type OrdersPage = DataOf<'/api/v1/orders', 'get'>;
export type Order = DataOf<'/api/v1/orders/{id}', 'get'>;
export type OrderLine = Order['lines'][number];
export type OrderStatus = Order['status'];
export type OrderCreate = BodyOf<'/api/v1/orders', 'post'>;
export type OrderUpdate = BodyOf<'/api/v1/orders/{id}', 'patch'>;
export type OrderPayment = NonNullable<Order['payment']>;
export type OrderEventsPage = DataOf<'/api/v1/orders/{id}/history', 'get'>;
export type OrderEvent = OrderEventsPage['items'][number];
export type ConditionOption = DataOf<
  '/api/v1/orders/payment-options/conditions',
  'get'
>['items'][number];
export type MethodOption = DataOf<'/api/v1/orders/payment-options/methods', 'get'>['items'][number];
export type FinancialState = DataOf<'/api/v1/orders/{id}/financial-state', 'get'>;
export type FinancialExecution = DataOf<'/api/v1/financial-executions', 'get'>['items'][number];

/* Financeiro administrativo */
export type Receivable = DataOf<'/api/v1/receivables/{id}', 'get'>;
export type ReceivableStatus = Receivable['status'];
export type Payment = DataOf<'/api/v1/payments/{id}', 'get'>;
export type FinancialEvent = DataOf<
  '/api/v1/orders/{id}/financial-history',
  'get'
>['items'][number];
export type ReceiptInput = BodyOf<'/api/v1/orders/{id}/receipts', 'post'>;
export type FinancialResult = DataOf<'/api/v1/orders/{id}/receipts', 'post'>;
export type CreditLot = DataOf<'/api/v1/customers/{id}/credits', 'get'>['items'][number];
export type CreditApplication = DataOf<'/api/v1/credit-applications/{id}', 'get'>;
export type RefundObligation = DataOf<'/api/v1/refund-obligations/{id}', 'get'>;
export type RefundConfirmation = DataOf<'/api/v1/refund-confirmations/{id}', 'get'>;
export type CreditInput = BodyOf<'/api/v1/orders/{id}/credit-applications', 'post'>;
export type PaymentReversalInput = BodyOf<'/api/v1/payments/{id}/reversals', 'post'>;
export type CreditReversalInput = BodyOf<'/api/v1/credit-applications/{id}/reversals', 'post'>;
export type RefundInput = BodyOf<'/api/v1/refund-obligations/{id}/confirm', 'post'>;
export type PaymentCondition = DataOf<'/api/v1/payment-conditions/{id}', 'get'>;
export type PaymentMethod = DataOf<'/api/v1/payment-methods/{id}', 'get'>;
export type ConditionCreate = BodyOf<'/api/v1/payment-conditions', 'post'>;
export type ConditionUpdate = BodyOf<'/api/v1/payment-conditions/{id}', 'patch'>;
export type MethodCreate = BodyOf<'/api/v1/payment-methods', 'post'>;
export type MethodUpdate = BodyOf<'/api/v1/payment-methods/{id}', 'patch'>;
export type CancellationInput = BodyOf<'/api/v1/orders/{id}/financial-cancellation', 'post'>;
export type ReturnResolutionInput = BodyOf<'/api/v1/returns/{id}/resolve', 'post'>;
export type ReturnView = DataOf<'/api/v1/returns/{id}', 'get'>;
export type ReturnPreview = DataOf<'/api/v1/returns/{id}/resolution-preview', 'get'>;
export type ProofReconciliation = DataOf<
  '/api/v1/financial-executions/{id}/proof-reconciliation',
  'get'
>;
export type JournalReconciliation = DataOf<'/api/v1/orders/{id}/financial-reconciliation', 'get'>;

export type RecordStatus = 'active' | 'inactive';
export type StatusFilter = 'active' | 'inactive' | 'all';

export type ReportView = DataOf<'/api/v1/reports/{report}', 'get'>;
export type ReportId = ReportView['report'];
export type ReportQuery = NonNullable<
  paths['/api/v1/reports/{report}']['get']['parameters']['query']
>;

export type Visit = DataOf<'/api/v1/visits', 'post'>;
export type VisitCreate = BodyOf<'/api/v1/visits', 'post'>;
export type VisitQuery = NonNullable<paths['/api/v1/visits']['get']['parameters']['query']>;
export type VisitSource = Visit['source'];
export type VisitKind = Visit['kind'];
export type RepurchasePage = DataOf<'/api/v1/repurchase', 'get'>;
export type RepurchaseRow = RepurchasePage['items'][number];
export type RepurchaseStatus = RepurchaseRow['status'];
export type CustomerRepurchase = DataOf<'/api/v1/customers/{id}/repurchase', 'get'>;
export type CustomerTimeline = DataOf<'/api/v1/customers/{id}/timeline', 'get'>;
export type TimelineEntry = CustomerTimeline['items'][number];
export type Delivery = DataOf<'/api/v1/orders/{id}/delivery', 'post'>;
export type DeliveryInput = BodyOf<'/api/v1/orders/{id}/delivery', 'post'>;
