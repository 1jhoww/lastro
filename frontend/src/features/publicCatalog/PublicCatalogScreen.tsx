import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { unwrap } from '@/api/client';
import { toApiError } from '@/api/errors';
import type { PublicProduct, QuoteInput, QuotePreview, WhatsappQuote } from '@/api/types';
import { Wordmark } from '@/brand';
import { Screen } from '@/layout/Screen';
import { useSession } from '@/session/SessionContext';
import { formatCents } from '@/lib/money';
import { Alert, Button, EmptyState, Panel, Select, Text, TextField } from '@/ui';
import { Store } from '@/ui/icons';
import { color, radius, space } from '@/theme';
import { publicImageUrl, quoteBody, safeWhatsappUrl, type CartLine } from './rules';
import { PublicProductImage } from './PublicProductImage';
import { useCooldown } from '@/lib/useCooldown';

const fresh = { staleTime: 0, gcTime: 0, retry: false as const, refetchOnMount: 'always' as const };
export function PublicCatalogScreen({ slug }: { slug: string }) {
  const { publicApi: api, apiBaseUrl } = useSession();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [review, setReview] = useState<{ preview: QuotePreview; input: QuoteInput } | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsappQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const cooldown = useCooldown();
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      sequence.current++;
      controller.current?.abort();
    },
    [],
  );
  const params = { path: { slug } };
  const profile = useQuery({
    ...fresh,
    queryKey: ['public-catalog', slug],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/public/catalogs/{slug}', {
          params,
          signal,
          cache: 'no-store',
          credentials: 'omit',
        }),
      ),
  });
  const products = useInfiniteQuery({
    ...fresh,
    queryKey: ['public-catalog', slug, 'products', search, category],
    initialPageParam: undefined as string | undefined,
    enabled: !!profile.data,
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/api/v1/public/catalogs/{slug}/products', {
          params: {
            path: { slug },
            query: {
              limit: '25',
              ...(search ? { q: search } : {}),
              ...(category ? { categoryId: category } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
          signal,
          cache: 'no-store',
          credentials: 'omit',
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const categories = useInfiniteQuery({
    ...fresh,
    queryKey: ['public-catalog', slug, 'categories'],
    initialPageParam: undefined as string | undefined,
    enabled: !!profile.data,
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET('/api/v1/public/catalogs/{slug}/categories', {
          params: {
            path: { slug },
            query: { limit: '50', ...(pageParam ? { cursor: pageParam } : {}) },
          },
          signal,
          cache: 'no-store',
          credentials: 'omit',
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const product = useQuery({
    ...fresh,
    queryKey: ['public-catalog', slug, 'product', detail],
    enabled: !!detail && !!profile.data,
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/public/catalogs/{slug}/products/{id}', {
          params: { path: { slug, id: detail! } },
          signal,
          cache: 'no-store',
          credentials: 'omit',
        }),
      ),
  });
  const editCart = (next: CartLine[]) => {
    sequence.current++;
    controller.current?.abort();
    setBusy(false);
    setCart(next);
    setReview(null);
    setWhatsapp(null);
    setError(null);
  };
  const add = (item: PublicProduct) => {
    if (cart.some((line) => line.id === item.id)) {
      setError('Produto já selecionado. Edite a quantidade na seleção.');
      return;
    }
    if (cart.length >= 200) {
      setError('Limite de 200 produtos por solicitação.');
      return;
    }
    editCart([...cart, { id: item.id, name: item.name, unit: item.unit, quantity: '1' }]);
  };
  const prepare = async (forWhatsapp: boolean) => {
    if (busy || cooldown.seconds) return;
    const current = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError(null);
    setWhatsapp(null);
    try {
      const input = forWhatsapp && review ? review.input : quoteBody(cart);
      if (forWhatsapp && !review)
        throw new Error('Revise o orçamento antes de preparar o WhatsApp.');
      if (forWhatsapp) {
        const result = await unwrap(
          api.POST('/api/v1/public/catalogs/{slug}/whatsapp', {
            params,
            body: { ...input, reviewToken: review!.preview.reviewToken },
            signal: abort.signal,
            cache: 'no-store',
            credentials: 'omit',
          }),
        );
        safeWhatsappUrl(result.whatsappUrl);
        if (sequence.current === current) setWhatsapp(result);
      } else {
        const preview = await unwrap(
          api.POST('/api/v1/public/catalogs/{slug}/quote-preview', {
            params,
            body: input,
            signal: abort.signal,
            cache: 'no-store',
            credentials: 'omit',
          }),
        );
        if (sequence.current === current) setReview({ preview, input });
      }
    } catch (e) {
      if (sequence.current === current) {
        setReview(null);
        setWhatsapp(null);
        const code = toApiError(e).code;
        cooldown.wait(toApiError(e).retryAfterSeconds);
        setError(
          code === 'QUOTE_CHANGED'
            ? 'Orçamento mudou. Faça nova revisão antes de continuar.'
            : code === 'PRODUCT_UNAVAILABLE'
              ? 'Produto retirado do catálogo. Atualize a lista e revise sua seleção.'
              : code === 'QUOTE_MESSAGE_LIMIT'
                ? 'Mensagem excede o limite. Reduza os itens e revise novamente.'
                : e instanceof Error && !('status' in e)
                  ? e.message
                  : toApiError(e).userMessage,
        );
      }
    } finally {
      if (sequence.current === current) setBusy(false);
    }
  };
  const refresh = () => {
    editCart([]);
    setDetail(null);
    profile.refetch();
    products.refetch();
    categories.refetch();
  };
  if (profile.isPending)
    return (
      <Screen title="Catálogo">
        <Text>Carregando catálogo…</Text>
      </Screen>
    );
  if (profile.isError || !profile.data)
    return (
      <Screen title="Catálogo indisponível">
        <Alert tone="warning" title="Não foi possível abrir o catálogo">
          O catálogo pode estar desativado ou temporariamente indisponível.
        </Alert>
        <Button label="Tentar novamente" onPress={() => profile.refetch()} />
      </Screen>
    );
  const rows = [
    ...new Map(
      products.data?.pages.flatMap((page) => page.items).map((item) => [item.id, item]) ?? [],
    ).values(),
  ];
  return (
    <Screen
      title={profile.data.tradeName}
      description={profile.data.description}
      actions={<Button label="Atualizar catálogo" variant="outline" onPress={refresh} />}
    >
      <View style={styles.content}>
        <Wordmark size={24} signature />
        <Alert title="Solicitação de orçamento">
          Selecione produtos e revise os dados atuais antes de abrir o WhatsApp. Não há pedido
          confirmado, reserva ou pagamento.
        </Alert>
        <Panel title="Produtos">
          <View style={styles.content}>
            <TextField
              label="Buscar por início do nome"
              value={q}
              maxLength={80}
              onChangeText={setQ}
              onSubmitEditing={() => setSearch(q.trim())}
            />
            <Button label="Buscar produtos" variant="outline" onPress={() => setSearch(q.trim())} />
            <Select
              label="Categoria"
              value={category}
              onChange={setCategory}
              options={[
                { value: '', label: 'Todas' },
                ...[
                  ...new Map(
                    categories.data?.pages
                      .flatMap((page) => page.items)
                      .map((item) => [item.id, item]) ?? [],
                  ).values(),
                ].map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
            {categories.hasNextPage ? (
              <Button
                label="Mais categorias"
                loading={categories.isFetchingNextPage}
                variant="ghost"
                onPress={() => categories.fetchNextPage()}
              />
            ) : null}
            {categories.isError ? (
              <Alert
                title="Categorias indisponíveis"
                action={
                  <Button
                    label="Recarregar categorias"
                    variant="outline"
                    onPress={() => categories.refetch()}
                  />
                }
              >
                Produtos continuam disponíveis sem filtro de categoria.
              </Alert>
            ) : null}
            {products.isPending ? (
              <Text>Carregando produtos…</Text>
            ) : products.isError ? (
              <Alert
                tone="danger"
                title="Não foi possível consultar produtos"
                action={
                  <Button
                    label="Reiniciar consulta"
                    onPress={() => products.refetch()}
                    variant="outline"
                  />
                }
              >
                {toApiError(products.error).userMessage}
              </Alert>
            ) : null}
            {!products.isPending && !products.isError && !rows.length ? (
              <EmptyState
                icon={Store}
                title="Nenhum produto nesta página"
                description={
                  products.hasNextPage
                    ? 'Há continuação. Carregue a próxima página.'
                    : 'Revise a busca e a categoria.'
                }
              />
            ) : null}
            <View style={styles.grid}>
              {rows.map((item) => (
                <View key={item.id} style={styles.product}>
                  {publicImageUrl(apiBaseUrl, item.imagePath, slug, item.id) ? (
                    <PublicProductImage slug={slug} id={item.id} name={item.name} />
                  ) : null}
                  <Text variant="h3">{item.name}</Text>
                  <Text>
                    {item.category?.name ?? 'Sem categoria'} · {item.unit}
                  </Text>
                  <Text>
                    {!profile.data.showPrices || item.unitPriceCents === null
                      ? 'Preço sob consulta'
                      : `${formatCents(item.unitPriceCents)} / ${item.unit}`}
                  </Text>
                  <Button
                    label={`Detalhes de ${item.name}`}
                    variant="ghost"
                    size="sm"
                    onPress={() => setDetail(item.id)}
                  />
                  <Button
                    label={`Selecionar ${item.name}`}
                    variant="outline"
                    onPress={() => add(item)}
                  />
                </View>
              ))}
            </View>
            {products.hasNextPage ? (
              <Button
                label="Mais produtos"
                loading={products.isFetchingNextPage}
                variant="outline"
                onPress={() => products.fetchNextPage()}
              />
            ) : null}
          </View>
        </Panel>
        {detail ? (
          <Panel title="Detalhes do produto">
            <View style={styles.content}>
              {product.isPending ? (
                <Text>Carregando produto…</Text>
              ) : product.isError ? (
                <Alert tone="warning" title="Produto indisponível">
                  Atualize o catálogo para consultar a seleção atual.
                </Alert>
              ) : product.data ? (
                <>
                  <Text variant="h3">{product.data.name}</Text>
                  <Text>{product.data.description || 'Sem descrição.'}</Text>
                  <Text>
                    {!profile.data.showPrices || product.data.unitPriceCents === null
                      ? 'Preço sob consulta'
                      : formatCents(product.data.unitPriceCents)}
                  </Text>
                  <Button
                    label="Adicionar este produto"
                    variant="outline"
                    onPress={() => add(product.data)}
                  />
                </>
              ) : null}
              <Button label="Fechar detalhes" variant="ghost" onPress={() => setDetail(null)} />
            </View>
          </Panel>
        ) : null}
        <Panel
          title={`Sua seleção (${cart.length})`}
          description="Quantidades inteiras para UN/CX/PCT; até três casas para KG/L."
        >
          <View style={styles.content}>
            {cart.length === 0 ? (
              <Text>Nenhum produto selecionado.</Text>
            ) : (
              cart.map((line) => (
                <View key={line.id} style={styles.content}>
                  <Text variant="bodyStrong">
                    {line.name} · {line.unit}
                  </Text>
                  <TextField
                    label={`Quantidade de ${line.name}`}
                    value={line.quantity}
                    keyboardType="decimal-pad"
                    onChangeText={(quantity) =>
                      editCart(
                        cart.map((item) => (item.id === line.id ? { ...item, quantity } : item)),
                      )
                    }
                  />
                  <Button
                    label={`Remover ${line.name}`}
                    variant="ghost"
                    size="sm"
                    onPress={() => editCart(cart.filter((item) => item.id !== line.id))}
                  />
                </View>
              ))
            )}
            <Button
              label="Revisar orçamento no servidor"
              disabled={!cart.length || cooldown.seconds > 0}
              loading={busy}
              onPress={() => prepare(false)}
            />
          </View>
        </Panel>
        {error ? (
          <Alert tone="danger" title="Revise a solicitação">
            {error}
          </Alert>
        ) : null}
        {cooldown.seconds ? (
          <Text>{`Aguarde ${cooldown.seconds} segundos antes de revisar novamente.`}</Text>
        ) : null}
        {review ? (
          <Panel
            title="Revisão do orçamento"
            description="Valores estimados, consultados no servidor. Envio manual pelo visitante."
          >
            <View style={styles.content}>
              {review.preview.lines.map((line) => (
                <Text key={line.productId}>
                  {line.name} · {line.quantity} {line.unit} ·{' '}
                  {line.subtotalCents === null ? 'Sob consulta' : formatCents(line.subtotalCents)}
                </Text>
              ))}
              <Text variant="bodyStrong">
                {review.preview.totalEstimatedCents === null
                  ? 'Total sob consulta'
                  : `Total estimado: ${formatCents(review.preview.totalEstimatedCents)}`}
              </Text>
              <Button
                label="Preparar mensagem para WhatsApp"
                disabled={cooldown.seconds > 0}
                loading={busy}
                onPress={() => prepare(true)}
              />
              {whatsapp ? (
                <>
                  <Text selectable>{whatsapp.message}</Text>
                  <Button
                    label="Abrir WhatsApp e revisar envio"
                    onPress={async () => {
                      try {
                        await Linking.openURL(safeWhatsappUrl(whatsapp.whatsappUrl));
                      } catch {
                        setError(
                          'Não foi possível abrir o WhatsApp. Verifique o aplicativo ou navegador e tente novamente.',
                        );
                      }
                    }}
                  />
                </>
              ) : null}
            </View>
          </Panel>
        ) : null}
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { gap: space[4] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4] },
  product: {
    flexGrow: 1,
    flexBasis: 240,
    maxWidth: 420,
    gap: space[3],
    padding: space[4],
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
  },
  image: {
    width: '100%',
    height: 170,
    resizeMode: 'contain',
    backgroundColor: color.surfaceSunken,
  },
});
