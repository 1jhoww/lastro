import { Image, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/session/SessionContext';
import { blobToDataUri } from '@/lib/blob';
import { color, radius } from '@/theme';
import { Package } from '@/ui/icons';

/**
 * Imagem do produto em moldura de proporção fixa (4:3). Sem imagem, carregando ou com falha:
 * mesmo marcador discreto, para a grade não "pular".
 */
export function PublicProductImage({
  slug,
  id,
  name,
  hasImage,
}: {
  slug: string;
  id: string;
  name: string;
  hasImage: boolean;
}) {
  const { publicApi } = useSession();
  const image = useQuery({
    queryKey: ['public-catalog', slug, 'image', id],
    enabled: hasImage,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await publicApi.GET('/api/v1/public/catalogs/{slug}/products/{id}/image', {
        params: { path: { slug, id } },
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
        throw new Error('Imagem indisponível');
      return blobToDataUri(result.data);
    },
  });
  return (
    <View style={styles.frame}>
      {image.data ? (
        <Image accessibilityLabel={name} source={{ uri: image.data }} style={styles.image} />
      ) : (
        <Package size={28} color={color.borderStrong} strokeWidth={1.5} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
    backgroundColor: color.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%', resizeMode: 'contain' },
});
