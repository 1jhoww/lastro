import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, type Href } from 'expo-router';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useQuery } from '@tanstack/react-query';
import { env } from '@/config/env';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import type { CatalogInput, Product } from '@/api/types';
import { FieldRow } from '@/features/catalog/FormParts';
import { useProductList, useUpdateProduct } from '@/features/products/api';
import { ReportAccess } from '@/features/reports/ReportAccess';
import {
  catalogInputSchema,
  formatWhatsapp,
  normalizeWhatsapp,
  slugify,
} from '@/features/publicCatalog/rules';
import { configureCatalog } from '@/features/publicCatalog/api';
import { intentLedger, intentScope, usePendingIntent } from '@/lib/intent';
import { fileLease } from '@/features/files/fileEpoch';
import { formatCents } from '@/lib/money';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { useSession, useTenantApi } from '@/session/SessionContext';
import { Screen } from '@/layout/Screen';
import { color, radius, space, useLayoutSize } from '@/theme';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  SearchField,
  Segmented,
  Skeleton,
  Switch,
  Text,
  TextField,
  useToast,
} from '@/ui';
import { Copy, Eye, Package } from '@/ui/icons';

export default function CatalogSettings() {
  return (
    <ReportAccess permission="catalog:manage">
      <Settings />
    </ReportAccess>
  );
}

type Form = Omit<CatalogInput, 'expectedVersion' | 'enabled'>;

function Settings() {
  const { api, tenantId, header } = useTenantApi();
  const { user, permissions } = useSession();
  const toast = useToast();
  const wide = useLayoutSize() === 'expanded';
  const scope = intentScope(user!.uid, tenantId, 'catalog-setting', 'catalog');
  const pending = usePendingIntent(scope);
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState<'save' | 'publish' | 'unpublish' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    intentLedger
      .hydrate(user!.uid, tenantId)
      .then(() => {
        if (alive.current) setReady(true);
      })
      .catch(() => {
        if (alive.current)
          setError('Não foi possível recuperar a última alteração. Reabra a tela antes de salvar.');
      });
    return () => {
      alive.current = false;
    };
  }, [user, tenantId]);
  const settings = useQuery({
    queryKey: ['tenant', tenantId, 'catalog-settings'],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/catalog-settings', { params: { header }, signal })),
    staleTime: 0,
  });
  const current = settings.data?.catalog ?? null;
  const published = current?.enabled ?? false;
  const webBase =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location?.origin
      : env?.webBaseUrl;
  const linkFor = (slug: string) =>
    webBase ? new URL(`/catalogo/${encodeURIComponent(slug)}`, webBase).href : null;

  const saved: Form = {
    slug: current?.slug ?? '',
    tradeName: current?.tradeName ?? '',
    description: current?.description ?? '',
    whatsappNumber: current?.whatsappNumber ?? '',
    showPrices: current?.showPrices ?? true,
  };
  const values = form ?? saved;
  const dirty = form !== null && JSON.stringify(form) !== JSON.stringify(saved);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    const next = { ...values, [key]: value };
    // Antes da primeira publicação, o endereço acompanha o nome até ser editado à mão.
    if (key === 'tradeName' && !current && !slugTouched) next.slug = slugify(String(value));
    setForm(next);
  };
  const locked = !!pending || busy !== null;

  const fieldErrors = {
    tradeName: values.tradeName.trim().length < 2 ? 'Informe o nome da distribuidora.' : undefined,
    slug:
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(values.slug) || values.slug.length < 3
        ? 'Use de 3 a 63 letras minúsculas, números e hífens, começando por letra.'
        : undefined,
    whatsappNumber: !/^[1-9][0-9]{7,14}$/.test(normalizeWhatsapp(values.whatsappNumber))
      ? 'Informe o WhatsApp com DDD. Ex.: (11) 99999-8888.'
      : undefined,
  };
  const [showErrors, setShowErrors] = useState(false);
  const shown: Partial<typeof fieldErrors> = showErrors ? fieldErrors : {};

  const submit = async (
    enabled: boolean,
    kind: 'save' | 'publish' | 'unpublish',
    retry = false,
  ) => {
    if (busy || !ready) return;
    const check = fileLease();
    const body: CatalogInput =
      retry && pending
        ? (pending.body as CatalogInput)
        : {
            ...values,
            tradeName: values.tradeName.trim(),
            description: values.description.trim(),
            whatsappNumber: normalizeWhatsapp(values.whatsappNumber),
            enabled,
            expectedVersion: current?.version ?? 0,
          };
    if (!retry && !catalogInputSchema.safeParse(body).success) {
      setShowErrors(true);
      setError('Revise os campos destacados.');
      return;
    }
    setBusy(kind);
    setError(null);
    try {
      await configureCatalog(api, tenantId, scope, body, check);
      check();
      if (!alive.current) return;
      setForm(null);
      setShowErrors(false);
      setSlugTouched(false);
      toast.show(
        kind === 'publish'
          ? 'Seu catálogo está publicado!'
          : kind === 'unpublish'
            ? 'Catálogo retirado do ar.'
            : published
              ? 'Alterações salvas e já visíveis no catálogo.'
              : 'Informações salvas.',
      );
      await settings.refetch();
    } catch (e) {
      if (alive.current)
        setError(
          toApiError(e).code === 'CATALOG_SLUG_UNAVAILABLE'
            ? 'Esse endereço já está em uso. Escolha outro.'
            : toApiError(e).code === 'CONFLICT'
              ? 'Outra pessoa alterou o catálogo. Recarregue para ver a versão atual.'
              : toApiError(e).userMessage,
        );
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const link = current ? linkFor(current.slug) : null;
  const slugChanged = !!current && values.slug !== current.slug;

  const info = (
    <Section title="Informações do catálogo">
      <FieldRow weights={[3, 2]}>
        {[
          <TextField
            key="name"
            label="Nome da distribuidora"
            value={values.tradeName}
            onChangeText={(v) => set('tradeName', v)}
            maxLength={160}
            editable={!locked}
            error={shown.tradeName}
          />,
          <TextField
            key="whatsapp"
            label="WhatsApp para orçamentos"
            value={values.whatsappNumber}
            onChangeText={(v) => set('whatsappNumber', v)}
            placeholder="(11) 99999-8888"
            keyboardType="phone-pad"
            editable={!locked}
            error={shown.whatsappNumber}
            hint={
              /^[1-9][0-9]{7,14}$/.test(normalizeWhatsapp(values.whatsappNumber))
                ? `Clientes falam com ${formatWhatsapp(normalizeWhatsapp(values.whatsappNumber))}`
                : 'Com DDD. Números de fora do Brasil: inclua o código do país.'
            }
          />,
        ]}
      </FieldRow>
      <TextField
        label="Descrição do catálogo"
        optional
        value={values.description}
        onChangeText={(v) => set('description', v)}
        placeholder="Ex.: Bebidas e mercearia com entrega em Campinas e região."
        multiline
        maxLength={1000}
        editable={!locked}
        style={styles.description}
      />
      <TextField
        label="Endereço do catálogo"
        value={values.slug}
        onChangeText={(v) => {
          setSlugTouched(true);
          set(
            'slug',
            v
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, '-')
              .slice(0, 63),
          );
        }}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!locked}
        error={shown.slug}
        hint={
          slugChanged && published
            ? `Ao salvar, o link anterior deixa de abrir o catálogo. Novo link: ${linkFor(values.slug) ?? values.slug}`
            : `Link: ${linkFor(values.slug || 'sua-distribuidora') ?? `/catalogo/${values.slug}`}`
        }
      />
      <Switch
        label="Mostrar preços no catálogo"
        description="Desligado, os clientes veem “Preço sob consulta” e o orçamento vai sem valores."
        value={values.showPrices}
        onChange={(v) => set('showPrices', v)}
        disabled={locked}
      />
      {dirty || !current ? (
        <View style={styles.formActions}>
          {dirty ? (
            <Button
              label="Descartar"
              variant="ghost"
              disabled={locked}
              onPress={() => {
                setForm(null);
                setShowErrors(false);
                setError(null);
              }}
            />
          ) : null}
          <Button
            label={published ? 'Salvar alterações' : 'Salvar'}
            variant={published ? 'strong' : 'outline'}
            loading={busy === 'save'}
            disabled={!ready || locked || (!dirty && !!current)}
            onPress={() => submit(published, 'save')}
          />
        </View>
      ) : null}
    </Section>
  );

  const publication = (
    <Section title="Publicação e link">
      {published ? (
        <>
          <View style={styles.status}>
            <Badge label="Publicado" tone="success" />
            <Text variant="small" color={color.textSecondary} style={styles.flex}>
              Seu catálogo está publicado. Alterações salvas aparecem na hora para os clientes.
            </Text>
          </View>
          {link ? (
            <View style={styles.link}>
              <Text variant="smallStrong" selectable numberOfLines={2} style={styles.flex}>
                {link}
              </Text>
            </View>
          ) : (
            <Text variant="small" color={color.textSecondary}>
              O endereço web do aplicativo não está configurado; use “Abrir catálogo”.
            </Text>
          )}
          <View style={styles.inline}>
            {link ? (
              <Button
                label="Copiar link"
                icon={Copy}
                size="sm"
                variant="strong"
                onPress={async () => {
                  try {
                    await Clipboard.setStringAsync(link);
                    toast.show('Link copiado.');
                  } catch {
                    setError('Não foi possível copiar. Selecione o link e copie manualmente.');
                  }
                }}
              />
            ) : null}
            {link && Platform.OS !== 'web' ? (
              <Button
                label="Abrir catálogo"
                icon={Eye}
                size="sm"
                variant="outline"
                onPress={() => Linking.openURL(link)}
              />
            ) : (
              <Link href={`/catalogo/${current!.slug}` as Href} target="_blank" asChild>
                <Button label="Abrir catálogo" icon={Eye} size="sm" variant="outline" />
              </Link>
            )}
            <Button
              label="Tirar do ar"
              size="sm"
              variant="ghost"
              disabled={locked || dirty}
              onPress={() => setConfirmOff(true)}
            />
          </View>
        </>
      ) : (
        <>
          <View style={styles.status}>
            <Badge label={current ? 'Não publicado' : 'Rascunho'} tone="neutral" />
            <Text variant="small" color={color.textSecondary} style={styles.flex}>
              {current
                ? 'Tudo pronto. Publique para os clientes acessarem o link.'
                : 'Preencha as informações. Você pode salvar e publicar de uma vez.'}
            </Text>
          </View>
          <Button
            label={dirty || !current ? 'Salvar e publicar' : 'Publicar catálogo'}
            variant="primary"
            loading={busy === 'publish'}
            disabled={!ready || locked}
            onPress={() => submit(true, 'publish')}
          />
          {current && link ? (
            <Text variant="caption" color={color.textSecondary}>
              {`Link após publicar: ${link}`}
            </Text>
          ) : null}
        </>
      )}
    </Section>
  );

  return (
    <Screen
      title="Catálogo público"
      description="Sua vitrine para clientes pedirem orçamento pelo WhatsApp. Não cria pedidos nem reserva estoque."
    >
      {settings.isError ? (
        <Alert
          tone="danger"
          title="Não foi possível carregar o catálogo"
          action={
            <Button
              label="Tentar de novo"
              size="sm"
              variant="outline"
              onPress={() => settings.refetch()}
            />
          }
        >
          {toApiError(settings.error).userMessage}
        </Alert>
      ) : null}
      {pending ? (
        <Alert
          tone="warning"
          title="Não sabemos se a última alteração foi salva"
          action={
            <Button
              label="Repetir alteração"
              size="sm"
              loading={busy !== null}
              onPress={() => submit((pending.body as CatalogInput).enabled, 'save', true)}
            />
          }
        >
          A conexão caiu antes da resposta. Repetir é seguro: a mesma alteração não é aplicada duas
          vezes.
        </Alert>
      ) : null}
      {error ? <Alert tone="danger" title={error} /> : null}

      {settings.isPending ? (
        <View style={{ gap: space[3] }}>
          <Skeleton height={20} width="40%" />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </View>
      ) : settings.data ? (
        <>
          <View style={[styles.columns, wide && styles.columnsWide]}>
            <View style={wide ? styles.colMain : null}>{info}</View>
            <View style={wide ? styles.colSide : null}>{publication}</View>
          </View>
          <CatalogProducts canManage={permissions.includes('products:manage')} />
        </>
      ) : null}

      <ConfirmDialog
        visible={confirmOff}
        title="Tirar o catálogo do ar?"
        description="O link deixa de abrir para os clientes até você publicar de novo. Produtos e configurações são mantidos."
        confirmLabel="Tirar do ar"
        tone="danger"
        loading={busy === 'unpublish'}
        onCancel={() => setConfirmOff(false)}
        onConfirm={async () => {
          await submit(false, 'unpublish');
          setConfirmOff(false);
        }}
      />
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="h3" accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

type Visibility = 'visible' | 'hidden' | 'inactive';

/** Visibilidade pública é do cadastro do produto; estoque não altera o que aparece. */
function CatalogProducts({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<Visibility>('visible');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search).trim();
  const { query, items } = useProductList(
    tab === 'inactive'
      ? { q, status: 'inactive' }
      : { q, status: 'active', catalogVisible: tab === 'visible' ? 'true' : 'false' },
  );
  return (
    <Section title="Produtos no catálogo">
      <Text variant="small" color={color.textSecondary}>
        Aparecem para os clientes os produtos ativos marcados como visíveis. Falta de estoque não
        esconde o produto.
      </Text>
      <View style={styles.filters}>
        <Segmented<Visibility>
          label="Visibilidade"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'visible', label: 'No catálogo' },
            { value: 'hidden', label: 'Ocultos' },
            { value: 'inactive', label: 'Inativos' },
          ]}
        />
        <SearchField
          label="Buscar produto"
          hideLabel
          placeholder="Buscar pelo início do nome"
          value={search}
          onChangeText={setSearch}
        />
      </View>
      {query.isPending ? (
        <View style={{ gap: space[2] }}>
          <Skeleton height={18} />
          <Skeleton height={18} width="70%" />
        </View>
      ) : query.isError ? (
        <Alert tone="danger" title="Não foi possível carregar os produtos">
          {toApiError(query.error).userMessage}
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState
          size="compact"
          icon={Package}
          title={
            q
              ? 'Nenhum produto com esse nome'
              : tab === 'visible'
                ? 'Nenhum produto no catálogo ainda'
                : tab === 'hidden'
                  ? 'Todos os produtos ativos estão no catálogo'
                  : 'Nenhum produto inativo'
          }
          description={
            tab === 'visible' && !q
              ? 'Abra “Ocultos” e ligue os produtos que quer mostrar.'
              : undefined
          }
        />
      ) : (
        <View style={styles.list}>
          {items.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              inactive={tab === 'inactive'}
              canManage={canManage}
            />
          ))}
          {query.hasNextPage ? (
            <Button
              label="Mais produtos"
              size="sm"
              variant="ghost"
              loading={query.isFetchingNextPage}
              onPress={() => query.fetchNextPage()}
            />
          ) : null}
        </View>
      )}
    </Section>
  );
}

function ProductRow({
  product: p,
  inactive,
  canManage,
}: {
  product: Product;
  inactive: boolean;
  canManage: boolean;
}) {
  const toast = useToast();
  const update = useUpdateProduct(p.id);
  return (
    <View style={styles.row}>
      <Link href={`/produtos/${p.id}` as Href} style={styles.flex}>
        <View>
          <Text variant="smallStrong" numberOfLines={1}>
            {p.name}
          </Text>
          <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
            {`${p.sku} · ${formatCents(p.priceCents)}`}
          </Text>
        </View>
      </Link>
      {inactive ? (
        <Badge label="Inativo" tone="neutral" />
      ) : canManage ? (
        <View style={styles.toggle}>
          <Switch
            label={p.catalogVisible ? 'Visível' : 'Oculto'}
            accessibilityLabel={`Mostrar ${p.name} no catálogo`}
            value={p.catalogVisible}
            disabled={update.isPending}
            onChange={(v) =>
              update.mutate(
                { catalogVisible: v, expectedVersion: p.version },
                {
                  onSuccess: () =>
                    toast.show(v ? `${p.name} aparece no catálogo.` : `${p.name} foi ocultado.`),
                  onError: (e) =>
                    toast.show(
                      toApiError(e).code === 'CONFLICT'
                        ? 'Produto alterado por outra pessoa. A lista foi atualizada.'
                        : toApiError(e).userMessage,
                    ),
                },
              )
            }
          />
        </View>
      ) : (
        <Badge
          label={p.catalogVisible ? 'Visível' : 'Oculto'}
          tone={p.catalogVisible ? 'success' : 'neutral'}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  columns: { gap: space[8] },
  columnsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  colMain: { flex: 3, minWidth: 0 },
  colSide: { flex: 2, minWidth: 0 },
  section: { gap: space[4] },
  sectionTitle: { paddingBottom: space[2], borderBottomWidth: 1, borderBottomColor: color.border },
  description: { minHeight: 56, textAlignVertical: 'top' },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space[2] },
  status: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  inline: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center' },
  filters: { gap: space[3] },
  list: { borderTopWidth: 1, borderTopColor: color.border },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 52,
    paddingVertical: space[1],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  toggle: { minWidth: 130 },
});
