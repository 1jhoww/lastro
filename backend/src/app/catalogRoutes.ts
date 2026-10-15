import { Router } from 'express';
import type { Route } from './routes.js';
import * as s from '../shared/schemas/catalog.js';
import { empty } from '../shared/schemas/http.js';
import type { CatalogService } from '../modules/catalog/catalogService.js';
import type { Config } from '../config/env.js';
import { publicCatalogRateLimit } from '../middlewares/rateLimit.js';

export const catalogRoutes: Route[] = [
  {
    method: 'get',
    path: '/catalog-settings',
    operationId: 'getCatalogSettings',
    scope: 'tenant',
    permission: 'catalog:manage',
    output: s.catalogAdminResult,
  },
  {
    method: 'put',
    path: '/catalog-settings',
    operationId: 'configureCatalog',
    scope: 'tenant',
    permission: 'catalog:manage',
    body: s.catalogConfigure,
    output: s.catalogAdminView,
    idempotent: true,
  },
  {
    method: 'get',
    path: '/public/catalogs/:slug',
    operationId: 'getPublicCatalog',
    scope: 'public',
    params: s.catalogParams,
    output: s.catalogPublicView,
  },
  {
    method: 'get',
    path: '/public/catalogs/:slug/products',
    operationId: 'listPublicProducts',
    scope: 'public',
    params: s.catalogParams,
    query: s.catalogProductsQuery,
    output: s.publicProductsPage,
  },
  {
    method: 'get',
    path: '/public/catalogs/:slug/categories',
    operationId: 'listPublicCategories',
    scope: 'public',
    params: s.catalogParams,
    query: s.publicPageQuery,
    output: s.publicCategoriesPage,
  },
  {
    method: 'get',
    path: '/public/catalogs/:slug/products/:id',
    operationId: 'getPublicProduct',
    scope: 'public',
    params: s.catalogProductParams,
    output: s.publicProductView,
  },
  {
    method: 'get',
    path: '/public/catalogs/:slug/products/:id/image',
    operationId: 'getPublicProductImage',
    scope: 'public',
    params: s.catalogProductParams,
    output: empty,
    binaryOutput: true,
  },
  {
    method: 'post',
    path: '/public/catalogs/:slug/quote-preview',
    operationId: 'previewPublicQuote',
    scope: 'public',
    params: s.catalogParams,
    body: s.quoteInput,
    output: s.quotePreviewView,
  },
  {
    method: 'post',
    path: '/public/catalogs/:slug/whatsapp',
    operationId: 'preparePublicWhatsapp',
    scope: 'public',
    params: s.catalogParams,
    body: s.whatsappInput,
    output: s.whatsappView,
  },
];
export function publicCatalogRoutes(catalog: CatalogService, config: Config) {
  const router = Router(),
    limiter = publicCatalogRateLimit(config, catalog.repo.foundation),
    handlers: Record<
      string,
      (slug: string, id: string, body: unknown, query: unknown) => Promise<unknown>
    > = {
      getPublicCatalog: (slug) => catalog.profile(slug),
      listPublicProducts: (slug, _id, _body, query) =>
        catalog.page(slug, s.catalogProductsQuery.parse(query)),
      listPublicCategories: (slug, _id, _body, query) =>
        catalog.page(slug, s.publicPageQuery.parse(query), true),
      getPublicProduct: (slug, id) => catalog.detail(slug, id),
      getPublicProductImage: (slug, id) => catalog.image(slug, id),
      previewPublicQuote: (slug, _id, body) => catalog.preview(slug, s.quoteInput.parse(body)),
      preparePublicWhatsapp: (slug, _id, body) =>
        catalog.whatsapp(slug, s.whatsappInput.parse(body)),
    };
  for (const route of catalogRoutes.filter((r) => r.scope === 'public')) {
    router[route.method](
      route.path.replace('/public', ''),
      (req, _res, next) => {
        route.params!.parse(req.params);
        (route.query ?? empty).parse(req.query);
        if (route.body) route.body.parse(req.body);
        else if (req.body !== undefined) empty.parse(req.body);
        next();
      },
      limiter,
      async (req, res) => {
        const { slug } = s.catalogParams.parse({ slug: req.params.slug }),
          id = typeof req.params.id === 'string' ? req.params.id : '';
        const result = await handlers[route.operationId]!(slug, id, req.body, req.query);
        if (route.binaryOutput) {
          res
            .type('image/webp')
            .set('Content-Disposition', 'inline; filename="product.webp"')
            .send(result);
          return;
        }
        res.json({ data: route.output.parse(result), requestId: req.requestId });
      },
    );
  }
  router.use((_req, res) =>
    res.status(404).json({
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: 'Recurso não encontrado',
        status: 404,
        requestId: _req.requestId,
      },
    }),
  );
  return router;
}
