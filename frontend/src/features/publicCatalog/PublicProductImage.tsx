import { Image } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/session/SessionContext';
import { blobToDataUri } from '@/lib/blob';
import { Text } from '@/ui';
export function PublicProductImage({ slug, id, name }: { slug: string; id: string; name: string }) {
  const { publicApi } = useSession();
  const image = useQuery({
    queryKey: ['public-catalog', slug, 'image', id],
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
  if (image.isError) return <Text variant="small">Imagem indisponível.</Text>;
  if (!image.data) return <Text variant="small">Carregando imagem…</Text>;
  return (
    <Image
      accessibilityLabel={name}
      source={{ uri: image.data }}
      style={{ width: '100%', height: 170, resizeMode: 'contain' }}
    />
  );
}
