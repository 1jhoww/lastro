import { Image, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { PublicCatalog } from '@/api/types';
import { Wordmark } from '@/brand';
import { blobToDataUri } from '@/lib/blob';
import { useSession } from '@/session/SessionContext';
import { color, radius, space, useLayoutSize } from '@/theme';
import { Text } from '@/ui';

/** Logo da vitrine: só o caminho que o servidor publica para este catálogo é aceito. */
export function logoVersion(slug: string, path: string | undefined) {
  if (!path) return undefined;
  const prefix = `/api/v1/public/catalogs/${encodeURIComponent(slug)}/logo?v=`;
  const v = path.startsWith(prefix) ? path.slice(prefix.length) : '';
  return /^[A-Za-z0-9_-]{1,128}$/.test(v) ? v : undefined;
}

/**
 * Cabeçalho da vitrine: a distribuidora em primeiro plano (logotipo, nome e descrição) e o
 * Lastro como assinatura discreta acima, à direita ("vitrine digital"). Sem logotipo, o nome
 * ocupa o lugar dele, sem moldura vazia. O logotipo só existe enquanto o plano da empresa
 * inclui identidade visual; o servidor decide isso a cada visita.
 */
export function StorefrontHeader({ slug, catalog }: { slug: string; catalog: PublicCatalog }) {
  const { publicApi } = useSession();
  const compact = useLayoutSize() === 'compact';
  const version = logoVersion(slug, catalog.logo?.path);
  const logo = useQuery({
    queryKey: ['public-catalog', slug, 'logo', version ?? ''],
    enabled: Boolean(version),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await publicApi.GET('/api/v1/public/catalogs/{slug}/logo', {
        params: { path: { slug }, query: { v: version } },
        parseAs: 'blob',
        cache: 'no-store',
        credentials: 'omit',
        signal,
      });
      if (
        !result.response.ok ||
        result.response.headers.get('Content-Type')?.split(';')[0] !== 'image/webp' ||
        !(result.data instanceof Blob) ||
        result.data.size > 5 * 1024 * 1024
      )
        throw new Error('Logotipo indisponível');
      return blobToDataUri(result.data);
    },
  });
  // Box from the real proportions: square logos stay square, wide ones get width, never blank.
  const maxHeight = compact ? 48 : 64,
    maxWidth = compact ? 168 : 240;
  const ratio = catalog.logo ? catalog.logo.width / catalog.logo.height : 1;
  const height = Math.min(maxHeight, maxWidth / ratio),
    width = height * ratio;
  const shown = Boolean(version && logo.data);

  return (
    <View style={styles.root}>
      <View style={styles.platform}>
        <Text variant="caption" color={color.textSecondary}>
          Vitrine digital
        </Text>
        <Wordmark size={13} />
      </View>
      <View style={[styles.identity, compact && styles.identityCompact]}>
        {shown ? (
          <View style={[styles.logo, { width, height }]}>
            <Image
              accessibilityLabel={`Logotipo de ${catalog.tradeName}`}
              source={{ uri: logo.data }}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
        ) : null}
        <View style={styles.headings}>
          <Text variant={compact ? 'h2' : 'h1'} accessibilityRole="header">
            {catalog.tradeName}
          </Text>
          {catalog.description ? (
            <Text variant="body" color={color.textSecondary}>
              {catalog.description}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[3] },
  platform: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space[1],
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space[5] },
  identityCompact: { flexDirection: 'column', alignItems: 'flex-start', gap: space[3] },
  logo: { borderRadius: radius.sm, overflow: 'hidden' },
  logoImage: { width: '100%', height: '100%' },
  headings: { flex: 1, minWidth: 0, gap: space[1], maxWidth: 680 },
});
