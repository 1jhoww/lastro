import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PlanCatalog, PlanFeature } from '@/api/types';
import { color, radius, space } from '@/theme';
import { Alert, Badge, Checkbox, Text } from '@/ui';
import { Lock } from '@/ui/icons';
import { featureLabel } from '../copy';
import { toggleFeature, type FeatureToggle } from './rules';

const list = (features: PlanFeature[]) => features.map((f) => featureLabel[f]).join(', ');

type Props = {
  catalog: PlanCatalog;
  value: PlanFeature[];
  onChange: (features: PlanFeature[]) => void;
  /** Esconde os módulos base onde o espaço é curto, como no ajuste de contrato. */
  hideBase?: boolean;
};

/**
 * Recursos contratados, por categoria, a partir do catálogo do backend. Módulos que todo plano tem
 * aparecem como incluídos. Marcar um recurso traz o que ele exige, e o aviso diz o que mudou junto.
 */
export function ResourcePicker({ catalog, value, onChange, hideBase }: Props) {
  const [last, setLast] = useState<(FeatureToggle & { code: PlanFeature }) | null>(null);
  const toggle = (code: PlanFeature) => {
    const result = toggleFeature(value, code, catalog.features);
    setLast({ ...result, code });
    onChange(result.features);
  };
  return (
    <View style={styles.root}>
      {hideBase ? null : (
        <View style={styles.category}>
          <Text variant="smallStrong">Incluídos em todos os planos</Text>
          <View style={styles.base}>
            {catalog.baseResources.map((resource) => (
              <View key={resource.code} style={styles.baseItem}>
                <Lock size={14} color={color.textSecondary} />
                <View style={styles.flex}>
                  <Text variant="body">{resource.label}</Text>
                  <Text variant="small" color={color.textSecondary}>
                    {resource.description}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
      {last && last.included.length > 0 ? (
        <Alert title="Incluídos automaticamente">
          {`${featureLabel[last.code]} exige ${list(last.included)}.`}
        </Alert>
      ) : null}
      {last && last.removed.length > 0 ? (
        <Alert tone="warning" title="Retirados junto">
          {`${list(last.removed)} depende de ${featureLabel[last.code]}.`}
        </Alert>
      ) : null}
      {catalog.categories.map((category) => {
        const features = catalog.features.filter((f) => f.category === category.code);
        const chosen = features.filter((f) => value.includes(f.code)).length;
        return (
          <View key={category.code} style={styles.category}>
            <View style={styles.categoryTop}>
              <Text variant="smallStrong">{category.label}</Text>
              <Badge
                label={`${chosen} de ${features.length}`}
                tone={chosen ? 'accent' : 'neutral'}
              />
            </View>
            {features.map((f) => (
              <Checkbox
                key={f.code}
                label={f.label}
                description={
                  f.requires.length ? `${f.description} Exige: ${list(f.requires)}.` : f.description
                }
                checked={value.includes(f.code)}
                onChange={() => toggle(f.code)}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[5] },
  category: { gap: space[1] },
  categoryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
    paddingBottom: space[1],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  base: {
    gap: space[3],
    padding: space[3],
    marginTop: space[1],
    borderRadius: radius.md,
    backgroundColor: color.canvas,
  },
  baseItem: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start' },
  flex: { flex: 1 },
});
