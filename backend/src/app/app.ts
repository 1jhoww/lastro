import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import type { Config } from '../config/env.js';
import type { Firebase } from '../infrastructure/firebase/client.js';
import { FoundationRepository } from '../infrastructure/repositories/foundationRepository.js';
import { AccessService } from '../modules/auth/accessService.js';
import { UserService } from '../modules/users/userService.js';
import { PlatformService } from '../modules/platformAdmin/platformService.js';
import { authentication } from '../middlewares/authentication.js';
import { requestContext, requestLog } from '../middlewares/requestContext.js';
import { errorHandler } from '../middlewares/errorHandler.js';
import { apiRateLimit } from '../middlewares/rateLimit.js';
import { AppError } from '../shared/errors/appError.js';
import { createRoutes } from './routes.js';
import { openApiDocument } from '../modules/auth/openapi.js';
import { CommercialRepository } from '../infrastructure/repositories/commercialRepository.js';
import { CustomerService } from '../modules/customers/customerService.js';
import { ProductService } from '../modules/products/productService.js';
import { CategoryService } from '../modules/categories/categoryService.js';
import { ImageService } from '../modules/products/imageService.js';
import { InventoryService } from '../modules/inventory/inventoryService.js';
import { FirestoreOrderStockAdapter } from '../modules/inventory/orderStockAdapter.js';
import { InitialOrderReceivables } from '../modules/receivables/orderReceivables.js';
import { OrderService } from '../modules/orders/orderService.js';
import { FinancialCommands } from '../modules/finance/financialCommands.js';
import { PaymentSettingsService } from '../modules/finance/paymentSettingsService.js';
import { FinancialService } from '../modules/finance/financialService.js';
import { FinancialReads } from '../modules/finance/financialReads.js';
import { ReturnStockAdapter } from '../modules/inventory/returnStockAdapter.js';
import { ReturnService } from '../modules/returns/returnService.js';
import { CatalogService } from '../modules/catalog/catalogService.js';
import { publicCatalogRoutes } from './catalogRoutes.js';
import { publicCatalogMemoryLimit } from '../middlewares/rateLimit.js';
import { DocumentService } from '../modules/documents/documentService.js';
import { ExportService } from '../modules/documents/exportService.js';
import { ingressLimit } from '../middlewares/ingressLimit.js';
import { readiness } from './readiness.js';
import { processingDeadline, HTTP_PROCESSING_MS } from '../middlewares/processingDeadline.js';
import { ReadGate } from '../shared/operations/readBudget.js';
import { ApplicationLifecycle, tracked } from './lifecycle.js';
export function createApp(
  config: Config,
  firebase: Firebase,
  clock: () => Date = () => new Date(),
  processingMs = HTTP_PROCESSING_MS,
  lifecycle = new ApplicationLifecycle(),
) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.set(
    'trust proxy',
    config.trustedProxyAddresses.length ? config.trustedProxyAddresses : false,
  );
  const repo = new FoundationRepository(firebase.db);
  const access = new AccessService(repo);
  const users = new UserService(repo, access, firebase.auth, config, clock);
  const platform = new PlatformService(repo, access, config, clock);
  const commercial = new CommercialRepository(repo, config.invitationSecret);
  const customers = new CustomerService(commercial, access, clock);
  const products = new ProductService(commercial, access, clock);
  const categories = new CategoryService(commercial, access, clock);
  const images = new ImageService(products, firebase);
  const inventory = new InventoryService(commercial, access, clock);
  const financialCommands = new FinancialCommands(commercial, access, clock);
  const paymentSettings = new PaymentSettingsService(financialCommands);
  const orderStock = new FirestoreOrderStockAdapter(inventory);
  const finance = new FinancialService(financialCommands, paymentSettings, orderStock);
  const financialReads = new FinancialReads(financialCommands);
  const returns = new ReturnService(finance, new ReturnStockAdapter(inventory));
  const catalog = new CatalogService(commercial, access, firebase, clock);
  const orders = new OrderService(
    commercial,
    access,
    orderStock,
    new InitialOrderReceivables(commercial),
    clock,
    paymentSettings,
  );
  const downloadBudget = new ReadGate();
  const documents = new DocumentService(orders, undefined, downloadBudget);
  const exports = new ExportService(
    customers,
    products,
    categories,
    orders,
    financialReads,
    downloadBudget,
  );
  app.use(requestContext, requestLog(config.nodeEnv !== 'test'));
  app.use(processingDeadline(processingMs));
  app.use(
    helmet({
      strictTransportSecurity: config.mode === 'production' ? { maxAge: 31536000 } : false,
    }),
  );
  app.use((req, _res, next) => {
    if (config.mode === 'production' && !req.secure && !req.path.startsWith('/health/'))
      throw new AppError(400, 'HTTPS_REQUIRED', 'HTTPS obrigatório');
    next();
  });
  app.use(
    '/api/v1/public',
    cors({
      origin: '*',
      credentials: false,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
    }),
  );
  const privateCors = cors({
    origin: (origin, callback) => {
      if (!origin || config.corsOrigins.includes(origin)) callback(null, true);
      else callback(new AppError(403, 'FORBIDDEN', 'Origem não permitida'));
    },
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Tenant-Id', 'Idempotency-Key'],
    exposedHeaders: [
      'X-Request-Id',
      'Retry-After',
      'Content-Disposition',
      'X-Next-Cursor',
      'X-Export-Row-Count',
    ],
  });
  app.use((req, res, next) => {
    if (req.path === '/api/v1/public' || req.path.startsWith('/api/v1/public/')) next();
    else privateCors(req, res, next);
  });
  app.use(lifecycle.middleware);
  app.use('/api/v1/public', publicCatalogMemoryLimit(config));
  const privateIngress = ingressLimit(config.rateLimitMax);
  app.use('/api/v1', (req, res, next) => {
    if (req.path === '/public' || req.path.startsWith('/public/')) next();
    else privateIngress(req, res, next);
  });
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get(
    '/health/ready',
    ingressLimit(120),
    readiness(() => lifecycle.run(() => firebase.db.doc('_health/readiness').get())),
  );
  app.use(express.json({ limit: '64kb', strict: true }));
  if (config.nodeEnv === 'development') {
    app.get('/openapi.json', (_req, res) => res.json(openApiDocument()));
    app.use(
      '/docs',
      swaggerUi.serve,
      swaggerUi.setup(openApiDocument(), { swaggerOptions: { persistAuthorization: false } }),
    );
  }
  app.use('/api/v1/public', publicCatalogRoutes(catalog, config));
  app.use(
    '/api/v1',
    (_req, res, next) => {
      res.set('Cache-Control', 'private, no-store');
      next();
    },
    tracked(apiRateLimit(config, repo)),
    tracked(authentication(firebase.auth, repo)),
    createRoutes(
      access,
      users,
      platform,
      clock,
      customers,
      products,
      categories,
      images,
      inventory,
      orders,
      paymentSettings,
      finance,
      financialReads,
      returns,
      catalog,
      documents,
      exports,
    ),
  );
  app.use((_req, _res) => {
    throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
  });
  app.use(errorHandler);
  return app;
}
