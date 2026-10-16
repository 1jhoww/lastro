import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import type { PublicProduct } from '@/api/types';
import { Wordmark } from '@/brand';
import { reserveViewer } from '@/features/files/presentation';
import { lineSubtotalPreview } from '@/features/orders/rules';
import { Screen } from '@/layout/Screen';
import { formatCents } from '@/lib/money';
import { unitLabel } from '@/lib/quantity';
import { useCooldown } from '@/lib/useCooldown';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { useSession } from '@/session/SessionContext';
import { color, radius, space, useLayoutSize } from '@/theme';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  QuantityInput,
  SearchField,
  Skeleton,
  Text,
} from '@/ui';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';
import { MessageCircle, SearchX, ShoppingBag, Store, Trash } from '@/ui/icons';
import { PublicProductImage } from './PublicProductImage';
import {
  MAX_QUOTE_LINES,
  publicImageUrl,
  quoteChanges,
  quoteItemsBody,
  safeWhatsappUrl,
  formatWhatsapp,
  type QuoteItem,
} from './rules';

const fresh = { staleTime: 0, gcTime: 0, retry: false as const, refetchOnMount: 'always' as const };
const request = { cache: 'no-store' as const, credentials: 'omit' as const };

type QuoteProduct = Omit<QuoteItem, 'quantityMilli'>;
type Notice = { tone: 'info' | 'warning' | 'danger' | 'success'; title: string; body?: string };

const unitName = { UN: 'unidade', CX: 'caixa', PCT: 'pacote', KG: 'quilo', L: 'litro' } as const;
const itemsLabel = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`;

/**
 * Vitrine pública: sem login, sem pedido, sem reserva. O visitante escolhe quantidades direto
 * nos cards; "Solicitar orçamento" confere preços e disponibilidade no servidor e, sem
 * divergências, abre o WhatsApp da distribuidora com a mensagem pronta. O envio é do visitante.
 */
export function PublicCatalogScreen({ slug }: { slug: string }) {
  const { publicApi: api, apiBaseUrl } = useSession();
  const size = useLayoutSize();
  const compact = size === 'compact';
  const wide = size === 'expanded';
  // Tablet e desktop: resumo lateral. Celular: barra inferior e painel.
  const side = !compact;
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search).trim().slice(0, 80);
  const [category, setCategory] = useState('');
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sentUrl, setSentUrl] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const cooldown = useCooldown();
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      sequence.current++;
      controller.current?.abort();
    },
    [],
  );

  const profile = useQuery({
    ...fresh,
    queryKey: ['public-catalog', slug],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/public/catalogs/{slug}', {
          params: { path: { slug } },
          signal,
          ...request,
        }),
      ),
  });
  const products = useInfiniteQuery({
    ...fresh,
    queryKey: ['public-catalog', slug, 'products', q, category],
    initialPageParam: undefined as string | undefined,
    enabled: !!profile.data,
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/api/v1/public/catalogs/{slug}/products', {
          params: {
            path: { slug },
            query: {
              limit: '24',
              ...(q ? { q } : {}),
              ...(category ? { categoryId: category } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
          signal,
          ...request,
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const categories = useQuery({
    ...fresh,
    queryKey: ['public-catalog', slug, 'categories'],
    enabled: !!profile.data,
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/public/catalogs/{slug}/categories', {
          params: { path: { slug }, query: { limit: '50' } },
          signal,
          ...request,
        }),
      ),
  });

  /** Editar quantidades invalida uma conferência em andamento e a mensagem já preparada. */
  const setQuantity = useCallback((product: QuoteProduct, milli: number) => {
    sequence.current++;
    controller.current?.abort();
    setSending(false);
    setSentUrl(null);
    setItems((current) => {
      if (milli <= 0) return current.filter((i) => i.id !== product.id);
      if (current.some((i) => i.id === product.id))
        return current.map((i) => (i.id === product.id ? { ...i, quantityMilli: milli } : i));
      if (current.length >= MAX_QUOTE_LINES) {
        setNotice({
          tone: 'warning',
          title: `Limite de ${MAX_QUOTE_LINES} produtos por orçamento.`,
        });
        return current;
      }
      return [...current, { ...product, quantityMilli: milli }];
    });
  }, []);
  const quantities = useMemo(() => new Map(items.map((i) => [i.id, i.quantityMilli])), [items]);
  const showPrices = profile.data?.showPrices ?? false;
  const total = items.every((i) => i.unitPriceCents !== null)
    ? items.reduce((sum, i) => sum + lineSubtotalPreview(i.unitPriceCents!, i.quantityMilli), 0)
    : null;

  /** Produtos do orçamento que saíram do catálogo (só consultado quando o servidor recusa). */
  const findUnavailable = async (signal: AbortSignal) => {
    const results = await Promise.all(
      items.map(async (item) => {
        const r = await api.GET('/api/v1/public/catalogs/{slug}/products/{id}', {
          params: { path: { slug, id: item.id } },
          signal,
          ...request,
        });
        return r.response.status === 404 ? item.id : null;
      }),
    );
    return new Set(results.filter((id): id is string => id !== null));
  };

  const requestQuote = async () => {
    if (sending || cooldown.seconds || !items.length) return;
    const current = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    // Web: a aba do WhatsApp nasce no toque; o link chega depois da conferência.
    const tab = Platform.OS === 'web' ? reserveViewer('Preparando seu orçamento…') : null;
    const stale = () => sequence.current !== current;
    setSending(true);
    setNotice(null);
    setSentUrl(null);
    try {
      const input = quoteItemsBody(items);
      const preview = await unwrap(
        api.POST('/api/v1/public/catalogs/{slug}/quote-preview', {
          params: { path: { slug } },
          body: input,
          signal: abort.signal,
          ...request,
        }),
      );
      if (stale()) return tab?.close();
      const changes = quoteChanges(items, preview);
      if (changes.length) {
        tab?.close();
        const prices = new Map(preview.lines.map((l) => [l.productId, l.unitPriceCents]));
        setItems((list) =>
          list.map((i) => (prices.has(i.id) ? { ...i, unitPriceCents: prices.get(i.id)! } : i)),
        );
        setNotice({
          tone: 'warning',
          title:
            changes.length === 1
              ? 'Um preço foi atualizado'
              : `${changes.length} preços foram atualizados`,
          body: `${changes
            .slice(0, 3)
            .map(
              (c) =>
                `${c.name}: ${c.from === null ? 'sob consulta' : formatCents(c.from)} → ${c.to === null ? 'sob consulta' : formatCents(c.to)}`,
            )
            .join(
              '; ',
            )}${changes.length > 3 ? '…' : ''}. Confira o total e toque em "Solicitar orçamento" de novo.`,
        });
        return;
      }
      const quote = await unwrap(
        api.POST('/api/v1/public/catalogs/{slug}/whatsapp', {
          params: { path: { slug } },
          body: { ...input, reviewToken: preview.reviewToken },
          signal: abort.signal,
          ...request,
        }),
      );
      if (stale()) return tab?.close();
      const url = safeWhatsappUrl(quote.whatsappUrl);
      setSentUrl(url);
      if (!tab?.show(url)) await Linking.openURL(url);
      setNotice({
        tone: 'success',
        title: 'Orçamento pronto para enviar pelo WhatsApp',
        body: 'Confira a mensagem e toque em enviar no WhatsApp. Seu orçamento continua aqui.',
      });
    } catch (e) {
      tab?.close();
      if (stale()) return;
      const error = toApiError(e);
      cooldown.wait(error.retryAfterSeconds);
      if (error.code === 'PRODUCT_UNAVAILABLE') {
        const gone = await findUnavailable(abort.signal).catch(() => new Set<string>());
        if (stale()) return;
        const names = items.filter((i) => gone.has(i.id)).map((i) => i.name);
        if (names.length) setItems((list) => list.filter((i) => !gone.has(i.id)));
        setNotice({
          tone: 'warning',
          title: names.length
            ? `${names.length === 1 ? 'Um produto saiu' : 'Alguns produtos saíram'} do catálogo`
            : 'Um produto do orçamento não está mais disponível',
          body: names.length
            ? `Retiramos do orçamento: ${names.join(', ')}. Confira e toque em "Solicitar orçamento" de novo.`
            : 'Atualize a página e monte o orçamento novamente.',
        });
      } else
        setNotice({
          tone: error.code === 'QUOTE_CHANGED' ? 'warning' : 'danger',
          title:
            error.code === 'QUOTE_CHANGED'
              ? 'Os valores mudaram agora há pouco'
              : 'Não foi possível preparar o orçamento',
          body:
            error.code === 'QUOTE_CHANGED'
              ? 'Toque em "Solicitar orçamento" de novo para conferir os valores atuais.'
              : error.code === 'QUOTE_MESSAGE_LIMIT' || error.code === 'QUOTE_VALUE_LIMIT'
                ? 'O orçamento ficou grande demais para uma mensagem. Divida em dois pedidos de orçamento.'
                : error.retryAfterSeconds
                  ? 'Muitas tentativas seguidas. Aguarde alguns segundos e tente de novo.'
                  : e instanceof Error && !('status' in e)
                    ? e.message
                    : 'Verifique sua conexão e tente de novo.',
        });
    } finally {
      if (!stale()) setSending(false);
    }
  };

  if (profile.isPending)
    return (
      <Screen title="Catálogo">
        <View style={styles.grid}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.cell, { width: compact ? '50%' : '25%' }]}>
              <Skeleton height={160} />
            </View>
          ))}
        </View>
      </Screen>
    );
  if (profile.isError || !profile.data)
    return (
      <Screen title="Catálogo indisponível">
        <EmptyState
          icon={Store}
          title="Este catálogo não está disponível"
          description="O endereço pode estar incorreto ou o catálogo foi retirado do ar pela distribuidora."
          action={
            <Button label="Tentar novamente" variant="outline" onPress={() => profile.refetch()} />
          }
        />
      </Screen>
    );

  const catalog = profile.data;
  const rows = [
    ...new Map(products.data?.pages.flatMap((p) => p.items).map((i) => [i.id, i]) ?? []).values(),
  ];
  const categoryList = categories.data?.items ?? [];
  const cols = wide ? 3 : 2;

  const summary = (
    <Summary
      items={items}
      total={total}
      showPrices={showPrices}
      sending={sending}
      cooldown={cooldown.seconds}
      notice={notice}
      sentUrl={sentUrl}
      onQuantity={setQuantity}
      onRequest={requestQuote}
      onDismiss={() => setNotice(null)}
      heading={!compact}
    />
  );

  const bar = compact ? (
    <View style={styles.bar}>
      <View style={styles.flex}>
        <Text variant="caption" color={color.textSecondary}>
          {items.length ? itemsLabel(items.length) : 'Orçamento vazio'}
        </Text>
        <Text variant="figure">
          {items.length ? (total === null ? 'Sob consulta' : formatCents(total)) : '—'}
        </Text>
      </View>
      <Button
        label="Ver orçamento"
        size="sm"
        variant={items.length ? 'strong' : 'outline'}
        icon={ShoppingBag}
        onPress={() => setCartOpen(true)}
      />
    </View>
  ) : undefined;

  return (
    <Screen title={catalog.tradeName} description={catalog.description || undefined} footer={bar}>
      <View style={styles.meta}>
        <View style={styles.metaItem}>
          <MessageCircle size={16} color={color.textSecondary} strokeWidth={1.75} />
          <Text variant="small" color={color.textSecondary}>
            {`Orçamentos pelo WhatsApp ${formatWhatsapp(catalog.whatsappNumber)}`}
          </Text>
        </View>
        <Text variant="small" color={color.textSecondary}>
          Sem compromisso: não é pedido confirmado.
        </Text>
      </View>

      <View style={[styles.layout, side && styles.layoutWide]}>
        <View style={[styles.main, side && styles.grow]}>
          <View style={styles.filters}>
            <SearchField
              label="Buscar produtos"
              hideLabel
              placeholder="Buscar produto pelo nome"
              value={search}
              maxLength={80}
              onChangeText={setSearch}
            />
            {categoryList.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chips}
              >
                {[{ id: '', name: 'Todos' }, ...categoryList].map((c) => (
                  <Chip
                    key={c.id || 'all'}
                    label={c.name}
                    selected={category === c.id}
                    onPress={() => setCategory(c.id)}
                  />
                ))}
              </ScrollView>
            ) : null}
          </View>

          {products.isPending ? (
            <View style={styles.grid}>
              {Array.from({ length: cols * 2 }, (_, i) => (
                <View key={i} style={[styles.cell, { width: `${100 / cols}%` }]}>
                  <Skeleton height={200} />
                </View>
              ))}
            </View>
          ) : products.isError ? (
            <Alert
              tone="danger"
              title="Não foi possível carregar os produtos"
              action={
                <Button
                  label="Tentar de novo"
                  size="sm"
                  variant="outline"
                  onPress={() => products.refetch()}
                />
              }
            >
              Verifique sua conexão e tente de novo.
            </Alert>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title={q ? `Nenhum produto encontrado para “${q}”` : 'Nenhum produto disponível'}
              description={q ? 'Tente outro nome ou o início da palavra.' : 'Volte mais tarde.'}
              action={
                q || category ? (
                  <Button
                    label="Limpar busca"
                    variant="outline"
                    onPress={() => {
                      setSearch('');
                      setCategory('');
                    }}
                  />
                ) : null
              }
            />
          ) : (
            <>
              <View style={styles.grid} accessibilityRole="list">
                {rows.map((p) => (
                  <View key={p.id} style={[styles.cell, { width: `${100 / cols}%` }]}>
                    <ProductCard
                      slug={slug}
                      product={p}
                      hasImage={!!publicImageUrl(apiBaseUrl, p.imagePath, slug, p.id)}
                      showPrices={showPrices}
                      quantity={quantities.get(p.id) ?? 0}
                      onQuantity={setQuantity}
                    />
                  </View>
                ))}
              </View>
              {products.hasNextPage ? (
                <View style={styles.more}>
                  <Button
                    label="Mostrar mais produtos"
                    variant="outline"
                    loading={products.isFetchingNextPage}
                    onPress={() => products.fetchNextPage()}
                  />
                </View>
              ) : null}
            </>
          )}
          <View style={styles.signature}>
            <Wordmark size={16} signature />
          </View>
        </View>

        {side ? (
          <View style={[styles.aside, !wide && styles.asideNarrow, sticky]}>{summary}</View>
        ) : null}
      </View>

      <Dialog
        visible={compact && cartOpen}
        title={`Seu orçamento · ${itemsLabel(items.length)}`}
        onClose={() => setCartOpen(false)}
      >
        {summary}
        <Button label="Continuar escolhendo" variant="ghost" onPress={() => setCartOpen(false)} />
      </Dialog>
    </Screen>
  );
}

const ProductCard = memo(function ProductCard({
  slug,
  product: p,
  hasImage,
  showPrices,
  quantity,
  onQuantity,
}: {
  slug: string;
  product: PublicProduct;
  hasImage: boolean;
  showPrices: boolean;
  quantity: number;
  onQuantity: (item: QuoteProduct, milli: number) => void;
}) {
  const price = showPrices ? p.unitPriceCents : null;
  const selected = quantity > 0;
  return (
    <View style={[styles.card, selected && styles.cardSelected]}>
      <PublicProductImage slug={slug} id={p.id} name={p.name} hasImage={hasImage} />
      <View style={styles.cardBody}>
        <Text variant="smallStrong" numberOfLines={2} style={styles.name}>
          {p.name}
        </Text>
        <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
          {p.category
            ? `${p.category.name} · ${unitLabel[p.unit]}`
            : `Vendido por ${unitName[p.unit]}`}
        </Text>
        <Text variant="figure">
          {price === null ? (
            <Text variant="small" color={color.textSecondary}>
              Preço sob consulta
            </Text>
          ) : (
            <>
              {formatCents(price)}
              <Text variant="caption" color={color.textSecondary}>{` /${unitLabel[p.unit]}`}</Text>
            </>
          )}
        </Text>
      </View>
      <QuantityInput
        label={`Quantidade de ${p.name}`}
        unit={p.unit}
        value={quantity}
        min={0}
        size="sm"
        onChange={(milli) =>
          onQuantity({ id: p.id, name: p.name, unit: p.unit, unitPriceCents: price }, milli)
        }
      />
    </View>
  );
});

function Summary({
  items,
  total,
  showPrices,
  sending,
  cooldown,
  notice,
  sentUrl,
  onQuantity,
  onRequest,
  onDismiss,
  heading,
}: {
  items: QuoteItem[];
  total: number | null;
  showPrices: boolean;
  sending: boolean;
  cooldown: number;
  notice: Notice | null;
  sentUrl: string | null;
  onQuantity: (item: QuoteProduct, milli: number) => void;
  onRequest: () => void;
  onDismiss: () => void;
  /** No painel do celular o título já vem do próprio painel. */
  heading: boolean;
}) {
  return (
    <View style={styles.summary}>
      {heading ? (
        <View style={styles.summaryHead}>
          <Text variant="h3" accessibilityRole="header">
            Seu orçamento
          </Text>
          <Text variant="small" color={color.textSecondary}>
            {itemsLabel(items.length)}
          </Text>
        </View>
      ) : null}
      {items.length === 0 ? (
        <View style={styles.empty}>
          <ShoppingBag size={22} color={color.borderStrong} strokeWidth={1.5} />
          <Text variant="small" color={color.textSecondary} align="center">
            Escolha as quantidades nos produtos para montar seu orçamento.
          </Text>
        </View>
      ) : (
        <ScrollView style={listScroll}>
          {items.map((item, i) => (
            <View key={item.id} style={[styles.line, i < items.length - 1 && styles.divider]}>
              <View style={styles.lineHead}>
                <View style={styles.flex}>
                  <Text variant="smallStrong" numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text variant="caption" color={color.textSecondary}>
                    {item.unitPriceCents === null
                      ? `Sob consulta · ${unitLabel[item.unit]}`
                      : `${formatCents(item.unitPriceCents)}/${unitLabel[item.unit]}`}
                  </Text>
                </View>
                <IconButton
                  icon={Trash}
                  label={`Remover ${item.name}`}
                  onPress={() => onQuantity(item, 0)}
                />
              </View>
              <View style={styles.lineControls}>
                <QuantityInput
                  label={`Quantidade de ${item.name}`}
                  unit={item.unit}
                  value={item.quantityMilli}
                  min={0}
                  size="sm"
                  onChange={(milli) => onQuantity(item, milli)}
                />
                <Text variant="figure">
                  {item.unitPriceCents === null
                    ? '—'
                    : formatCents(lineSubtotalPreview(item.unitPriceCents, item.quantityMilli))}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
      <View style={styles.totalLine}>
        <Text variant="body" color={color.textSecondary}>
          Total estimado
        </Text>
        <Text variant="figureLarge">
          {!items.length
            ? '—'
            : total === null || !showPrices
              ? 'Sob consulta'
              : formatCents(total)}
        </Text>
      </View>
      {notice ? (
        <Alert
          tone={notice.tone}
          title={notice.title}
          action={
            notice.tone === 'success' && sentUrl ? (
              <Button
                label="Abrir WhatsApp de novo"
                size="sm"
                variant="outline"
                onPress={() => Linking.openURL(sentUrl).catch(onDismiss)}
              />
            ) : null
          }
        >
          {notice.body ?? ''}
        </Alert>
      ) : null}
      <Button
        label="Solicitar orçamento"
        icon={MessageCircle}
        variant="primary"
        fullWidth
        loading={sending}
        disabled={!items.length || cooldown > 0}
        onPress={onRequest}
      />
      <Text variant="caption" color={color.textSecondary} align="center">
        {cooldown
          ? `Aguarde ${cooldown} s para tentar de novo.`
          : 'Conferimos preços e disponibilidade antes de abrir o WhatsApp. Você revisa e envia.'}
      </Text>
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={(s: InteractionState) => [
        styles.chip,
        selected && styles.chipSelected,
        (s.hovered || s.pressed) && !selected && styles.chipHover,
        showFocusRing(s) && focusRing(),
      ]}
    >
      <Text variant="smallStrong" color={selected ? color.onStructure : color.text}>
        {label}
      </Text>
    </Pressable>
  );
}

// Web: resumo lateral acompanha a rolagem; a lista rola sozinha quando passa da altura da tela.
const sticky = (Platform.OS === 'web' ? { position: 'sticky', top: space[6] } : {}) as ViewStyle;
const listScroll = (Platform.OS === 'web' ? { maxHeight: 'calc(100vh - 360px)' } : {}) as ViewStyle;

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4], marginTop: -space[3] },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  layout: { gap: space[6] },
  layoutWide: { flexDirection: 'row', alignItems: 'flex-start' },
  main: { minWidth: 0, gap: space[4] },
  grow: { flex: 1 },
  filters: { gap: space[3] },
  chips: { gap: space[2], paddingVertical: 2 },
  chip: {
    paddingHorizontal: space[3],
    minHeight: 34,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  chipSelected: { backgroundColor: color.structure, borderColor: color.structure },
  chipHover: { backgroundColor: 'rgba(17,17,17,0.04)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space[2] / 2 - 2 },
  cell: { padding: space[2] / 2 + 2 },
  card: {
    flex: 1,
    gap: space[2],
    padding: space[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  // Selecionado: borda amarela discreta e fundo levemente quente.
  cardSelected: { borderColor: color.accent, backgroundColor: '#FFFCF2' },
  cardBody: { flex: 1, gap: 2 },
  name: { minHeight: 36 },
  more: { alignItems: 'center', paddingTop: space[2] },
  signature: { alignItems: 'center', paddingTop: space[6], opacity: 0.7 },
  aside: {
    width: 360,
    padding: space[4],
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
  },
  asideNarrow: { width: 300 },
  summary: { gap: space[3] },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space[3],
  },
  empty: { alignItems: 'center', gap: space[2], paddingVertical: space[5] },
  line: { gap: space[2], paddingVertical: space[2] },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  lineHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  lineControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.surface,
  },
});
