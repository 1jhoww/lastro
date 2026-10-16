import type { Transaction, Query } from 'firebase-admin/firestore';
import { FieldPath } from 'firebase-admin/firestore';
import type { z } from 'zod';
import * as s from '../../shared/schemas/catalog.js';
import {
  productSchema,
  categorySchema,
  searchKey,
  type Product,
} from '../../shared/schemas/commercial.js';
import { tenantSchema, subscriptionSchema } from '../../shared/schemas/models.js';
import type { CommercialRepository } from '../../infrastructure/repositories/commercialRepository.js';
import type { AccessService } from '../auth/accessService.js';
import type { Actor } from '../../shared/types/context.js';
import type { Firebase } from '../../infrastructure/firebase/client.js';
import { publicCatalogAllowed } from '../users/permissions.js';
import { entitlementsFor, hasFeature } from '../plans/catalog.js';
import { AppError, requireCondition } from '../../shared/errors/appError.js';
import { recordAudit } from '../../shared/audit/audit.js';
import { digest, stableJson, equalDigest } from '../../shared/utils/crypto.js';
import { assertDocumentFits } from '../orders/technicalSize.js';
import { snapshotLine } from '../orders/calculation.js';
import { MAX_ORDER_CENTS } from '../../shared/schemas/orders.js';
import { parseQuantity, formatQuantity } from '../inventory/quantities.js';
import { quoteReviewToken, quoteMessage, whatsappLink } from './quoteCalculation.js';
import { MAX_IMAGE_BYTES } from '../products/imageService.js';
import { encodePublicCursor, decodePublicCursor } from './publicCursor.js';

export class CatalogService {
  constructor(
    readonly repo: CommercialRepository,
    readonly access: AccessService,
    readonly firebase: Firebase,
    readonly clock: () => Date,
  ) {}

  async settings(tx: Transaction, tenantId: string) {
    const value = await this.repo.foundation.read(
      this.repo.ref(tenantId, 'catalogSettings', 'current'),
      s.catalogSettingsSchema,
      tx,
    );
    requireCondition(
      !value || value.tenantId === tenantId,
      500,
      'INTERNAL_ERROR',
      'Erro interno do servidor',
    );
    return value;
  }
  async adminGet(actor: Actor, tenantId: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        await this.access.tenant(actor, tenantId, 'catalog:manage', tx);
        const value = await this.settings(tx, tenantId);
        return { catalog: value ? s.catalogAdminView.parse(value) : null };
      },
      { readOnly: true },
    );
  }
  async configure(
    actor: Actor,
    tenantId: string,
    input: z.infer<typeof s.catalogConfigure>,
    key: string,
  ) {
    const op = digest(`catalog:${key}`),
      payloadHash = digest(stableJson(input));
    return this.repo.foundation.db.runTransaction(async (tx) => {
      await this.access.tenant(actor, tenantId, 'catalog:manage', tx);
      const opRef = this.repo.ref(tenantId, 'catalogOperations', op),
        previous = await this.repo.foundation.read(opRef, s.catalogOperationSchema, tx);
      if (previous) {
        requireCondition(
          previous.actorUid === actor.uid && previous.payloadHash === payloadHash,
          409,
          'CONFLICT',
          'Chave já utilizada com outra intenção',
        );
        return previous.result;
      }
      const current = await this.settings(tx, tenantId),
        slugRef = this.repo.foundation.global('catalogSlugs', input.slug),
        reserved = await this.repo.foundation.read(slugRef, s.catalogSlugSchema, tx);
      requireCondition(
        input.expectedVersion === (current?.version ?? 0),
        409,
        'CONFLICT',
        'Versão do catálogo desatualizada',
      );
      requireCondition(
        !reserved || (reserved.tenantId === tenantId && reserved.slug === input.slug),
        409,
        'CATALOG_SLUG_UNAVAILABLE',
        'Identificador público indisponível',
      );
      const now = this.clock().toISOString(),
        { expectedVersion: _version, ...fields } = input;
      const next = s.catalogSettingsSchema.parse({
        ...fields,
        tenantId,
        version: (current?.version ?? 0) + 1,
        createdAt: current?.createdAt ?? now,
        createdBy: current?.createdBy ?? actor.uid,
        updatedAt: now,
        updatedBy: actor.uid,
        schemaVersion: 1,
      });
      const result = s.catalogAdminView.parse(next),
        operation = s.catalogOperationSchema.parse({
          actorUid: actor.uid,
          payloadHash,
          result,
          createdAt: now,
          schemaVersion: 1,
        });
      assertDocumentFits(this.repo.ref(tenantId, 'catalogSettings', 'current').path, next);
      assertDocumentFits(opRef.path, operation);
      tx.set(slugRef, { tenantId, slug: input.slug, schemaVersion: 1 });
      tx.set(this.repo.ref(tenantId, 'catalogSettings', 'current'), next);
      tx.create(opRef, operation);
      recordAudit(this.repo.foundation, tx, actor, tenantId, 'catalog.configured', 'current', now, {
        before: current ? s.catalogAdminView.parse(current) : null,
        after: result,
      });
      return result;
    });
  }
  async resolve(tx: Transaction, slug: string) {
    const reservation = await this.repo.foundation.read(
      this.repo.foundation.global('catalogSlugs', slug),
      s.catalogSlugSchema,
      tx,
    );
    requireCondition(
      reservation?.slug === slug,
      404,
      'CATALOG_UNAVAILABLE',
      'Catálogo indisponível',
    );
    const [tenant, catalog] = await Promise.all([
      this.repo.foundation.read(
        this.repo.foundation.global('tenants', reservation.tenantId),
        tenantSchema,
        tx,
      ),
      this.settings(tx, reservation.tenantId),
    ]);
    requireCondition(
      tenant?.id === reservation.tenantId &&
        tenant.status === 'active' &&
        catalog?.enabled &&
        catalog.slug === slug,
      404,
      'CATALOG_UNAVAILABLE',
      'Catálogo indisponível',
    );
    const subscription = await this.repo.foundation.read(
      this.repo.foundation.global('subscriptions', tenant.subscriptionId),
      subscriptionSchema,
      tx,
    );
    requireCondition(
      subscription?.id === tenant.subscriptionId &&
        subscription.tenantId === tenant.id &&
        publicCatalogAllowed(subscription.status) &&
        hasFeature(entitlementsFor(subscription), 'catalog.public'),
      404,
      'CATALOG_UNAVAILABLE',
      'Catálogo indisponível',
    );
    return catalog;
  }
  publicView(catalog: s.CatalogSettings) {
    return s.catalogPublicView.parse(catalog);
  }
  async profile(slug: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => this.publicView(await this.resolve(tx, slug)),
      { readOnly: true },
    );
  }
  async product(tx: Transaction, catalog: s.CatalogSettings, id: string) {
    const product = await this.repo.foundation.read(
      this.repo.ref(catalog.tenantId, 'products', id),
      productSchema,
      tx,
    );
    requireCondition(
      product?.id === id &&
        product.tenantId === catalog.tenantId &&
        product.status === 'active' &&
        product.catalogVisible,
      404,
      'PRODUCT_UNAVAILABLE',
      'Produto indisponível no catálogo',
    );
    return product;
  }
  async productView(tx: Transaction, catalog: s.CatalogSettings, product: Product) {
    const category = product.categoryId
      ? await this.repo.foundation.read(
          this.repo.ref(catalog.tenantId, 'categories', product.categoryId),
          categorySchema,
          tx,
        )
      : null;
    requireCondition(
      !category || (category.tenantId === catalog.tenantId && category.id === product.categoryId),
      500,
      'INTERNAL_ERROR',
      'Erro interno do servidor',
    );
    return s.publicProductView.parse({
      id: product.id,
      name: product.name,
      description: product.description,
      unit: product.unit,
      quantityPrecision: product.quantityPrecision,
      category: category?.status === 'active' ? { id: category.id, name: category.name } : null,
      unitPriceCents: catalog.showPrices ? product.priceCents : null,
      imagePath: product.image
        ? `/api/v1/public/catalogs/${catalog.slug}/products/${product.id}/image`
        : null,
    });
  }
  async detail(slug: string, id: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        const catalog = await this.resolve(tx, slug);
        return this.productView(tx, catalog, await this.product(tx, catalog, id));
      },
      { readOnly: true },
    );
  }
  async page(slug: string, input: z.infer<typeof s.catalogProductsQuery>, categories = false) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        const catalog = await this.resolve(tx, slug),
          collection = categories ? 'categories' : 'products',
          scope = digest(
            stableJson({
              kind: 'public-catalog',
              tenantId: catalog.tenantId,
              slug,
              version: catalog.version,
              collection,
              ...input,
              cursor: undefined,
            }),
          );
        let query: Query = this.repo
          .ref(catalog.tenantId, collection, 'placeholder')
          .parent.where('status', '==', 'active');
        if (!categories) query = query.where('catalogVisible', '==', true);
        if (input.categoryId) {
          const category = await this.repo.foundation.read(
            this.repo.ref(catalog.tenantId, 'categories', input.categoryId),
            categorySchema,
            tx,
          );
          if (
            !category ||
            category.id !== input.categoryId ||
            category.tenantId !== catalog.tenantId ||
            category.status !== 'active'
          )
            return { items: [], nextCursor: null };
          query = query.where('categoryId', '==', input.categoryId);
        }
        if (input.q) {
          const prefix = searchKey(input.q);
          query = query.where('nameKey', '>=', prefix).where('nameKey', '<=', prefix + '\uf8ff');
        }
        query = query.orderBy('nameKey').orderBy(FieldPath.documentId());
        const cursorId = decodePublicCursor(this.repo.secret, scope, input.cursor);
        if (cursorId) {
          const cursor = await tx.get(this.repo.ref(catalog.tenantId, collection, cursorId));
          requireCondition(cursor.exists, 422, 'VALIDATION_ERROR', 'Cursor indisponível');
          query = query.startAfter(cursor);
        }
        const limit = Number(input.limit ?? '25'),
          page = await tx.get(query.limit(limit + 1)),
          docs = page.docs.slice(0, limit);
        const values = await Promise.all(
          docs.map(async (d) => {
            if (!categories) {
              const product = productSchema.parse(d.data());
              requireCondition(
                product.id === d.id &&
                  product.tenantId === catalog.tenantId &&
                  product.status === 'active' &&
                  product.catalogVisible,
                500,
                'INTERNAL_ERROR',
                'Erro interno do servidor',
              );
              return this.productView(tx, catalog, product);
            }
            const c = categorySchema.parse(d.data());
            requireCondition(
              c.id === d.id && c.tenantId === catalog.tenantId,
              500,
              'INTERNAL_ERROR',
              'Erro interno do servidor',
            );
            const published = await tx.get(
              this.repo
                .ref(catalog.tenantId, 'products', 'placeholder')
                .parent.where('status', '==', 'active')
                .where('catalogVisible', '==', true)
                .where('categoryId', '==', c.id)
                .limit(1),
            );
            if (published.empty) return null;
            const product = productSchema.parse(published.docs[0]!.data());
            requireCondition(
              product.id === published.docs[0]!.id &&
                product.tenantId === catalog.tenantId &&
                product.categoryId === c.id,
              500,
              'INTERNAL_ERROR',
              'Erro interno do servidor',
            );
            return { id: c.id, name: c.name };
          }),
        );
        return {
          items: values.filter((v) => v !== null),
          nextCursor:
            page.size > limit
              ? encodePublicCursor(this.repo.secret, scope, docs[docs.length - 1]!.id)
              : null,
        };
      },
      { readOnly: true },
    );
  }
  async preview(slug: string, input: z.infer<typeof s.quoteInput>, reviewedToken?: string) {
    return this.repo.foundation.db.runTransaction(
      async (tx) => {
        const catalog = await this.resolve(tx, slug),
          products = await Promise.all(
            input.lines.map((l) => this.product(tx, catalog, l.productId)),
          );
        const lines = input.lines.map((row, index) => {
          const p = products[index]!,
            scaled = parseQuantity(row.quantity, p.unit);
          requireCondition(scaled > 0, 422, 'INVALID_QUANTITY', 'Quantidade deve ser positiva');
          let priced: ReturnType<typeof snapshotLine> | null = null;
          if (catalog.showPrices) {
            try {
              priced = snapshotLine(p.id, p, row.quantity);
            } catch (error) {
              if (error instanceof AppError && error.code === 'ORDER_VALUE_LIMIT')
                throw new AppError(
                  422,
                  'QUOTE_VALUE_LIMIT',
                  'Valor estimado acima do limite técnico',
                );
              throw error;
            }
          }
          return {
            productId: p.id,
            name: p.name,
            unit: p.unit,
            quantity: formatQuantity(scaled),
            unitPriceCents: catalog.showPrices ? p.priceCents : null,
            subtotalCents: priced?.subtotalCents ?? null,
          };
        });
        const total = catalog.showPrices
          ? lines.reduce((sum, l) => sum + l.subtotalCents!, 0)
          : null;
        requireCondition(
          total === null || total <= MAX_ORDER_CENTS,
          422,
          'QUOTE_VALUE_LIMIT',
          'Valor estimado acima do limite técnico',
        );
        const summary = s.quoteSummary.parse({
            catalog: this.publicView(catalog),
            lines,
            currency: 'BRL',
            totalEstimatedCents: total,
            kind: 'quote_request',
            confirmedOrder: false,
          }),
          reviewToken = quoteReviewToken(this.repo.secret, catalog.tenantId, summary);
        if (reviewedToken !== undefined)
          requireCondition(
            equalDigest(reviewedToken, reviewToken),
            409,
            'QUOTE_CHANGED',
            'Orçamento alterado; revise novo resumo antes de abrir o WhatsApp',
          );
        return { ...summary, reviewToken };
      },
      { readOnly: true },
    );
  }
  async whatsapp(slug: string, input: z.infer<typeof s.whatsappInput>) {
    const summary = await this.preview(slug, input, input.reviewToken),
      message = quoteMessage(summary);
    return {
      ...summary,
      message,
      whatsappUrl: whatsappLink(summary.catalog.whatsappNumber, message),
    };
  }
  async image(slug: string, id: string) {
    const read = () =>
      this.repo.foundation.db.runTransaction(
        async (tx) => {
          const catalog = await this.resolve(tx, slug),
            product = await this.product(tx, catalog, id);
          requireCondition(product.image, 404, 'PRODUCT_IMAGE_UNAVAILABLE', 'Imagem indisponível');
          return { tenantId: catalog.tenantId, image: product.image };
        },
        { readOnly: true },
      );
    const before = await read(),
      path = `tenants/${before.tenantId}/products/${id}/${before.image.id}.webp`,
      [data] = await this.firebase.bucket.file(path).download();
    requireCondition(
      data.length === before.image.sizeBytes && data.length <= MAX_IMAGE_BYTES,
      500,
      'INTERNAL_ERROR',
      'Erro interno do servidor',
    );
    const after = await read();
    requireCondition(
      before.tenantId === after.tenantId && before.image.id === after.image.id,
      409,
      'CONFLICT',
      'Imagem alterada; tente novamente',
    );
    return data;
  }
}
