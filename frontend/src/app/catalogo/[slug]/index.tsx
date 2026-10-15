import { useLocalSearchParams } from 'expo-router';
import { PublicCatalogScreen } from '@/features/publicCatalog/PublicCatalogScreen';
export default function PublicCatalogRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <PublicCatalogScreen key={slug} slug={slug} />;
}
