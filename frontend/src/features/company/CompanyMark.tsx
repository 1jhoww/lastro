import { Image, StyleSheet, View } from 'react-native';
import type { Tenant } from '@/api/types';
import { useSession } from '@/session/SessionContext';
import { radius } from '@/theme';
import { useCompanyLogo } from './api';

/**
 * Logotipo da empresa em miniatura, sobre fundo claro para funcionar na barra escura. Sem
 * logotipo (ou enquanto carrega) não ocupa espaço: o nome continua sozinho como antes. Só aparece
 * enquanto o plano inclui identidade visual, como nos documentos e no catálogo.
 */
export function CompanyMark({ tenant, size = 36 }: { tenant: Tenant | undefined; size?: number }) {
  const { membership } = useSession();
  const included = membership?.plan.features.includes('branding.custom') ?? false;
  const logo = useCompanyLogo(included ? tenant : undefined);
  if (!included || !tenant?.logo || !logo.data) return null;
  return (
    <View
      style={[styles.box, { width: size, height: size }]}
      accessibilityLabel={`Logotipo de ${tenant.name}`}
    >
      <Image source={{ uri: logo.data }} style={styles.image} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radius.sm,
    backgroundColor: '#ffffff',
    padding: 3,
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
});
