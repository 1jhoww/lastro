import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { SupplierOption } from '@/api/types';
import { formatDocument } from '@/lib/document';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { color, layout, space } from '@/theme';
import { Alert, Button, Dialog, SearchField, Skeleton, Text } from '@/ui';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';
import { useSuppliers } from './api';

/** Fornecedores ativos, pelo início do nome. */
export function SupplierPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (supplier: SupplierOption) => void;
}) {
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search).trim();
  const { query, items } = useSuppliers(q, visible);
  if (!visible) return null;
  return (
    <Dialog
      visible
      title="Escolher fornecedor"
      onClose={onClose}
      actions={<Button label="Fechar" variant="ghost" onPress={onClose} />}
    >
      <View style={styles.body}>
        <SearchField
          label="Buscar fornecedor"
          hideLabel
          placeholder="Buscar pelo início do nome"
          value={search}
          onChangeText={setSearch}
          autoFocus
        />
        {query.isError ? (
          <Alert tone="danger" title="Não foi possível carregar os fornecedores">
            {toApiError(query.error).userMessage}
          </Alert>
        ) : query.isPending ? (
          <Skeleton width="60%" height={16} />
        ) : items.length === 0 ? (
          <Text variant="body" color={color.textSecondary}>
            {q
              ? 'Nenhum fornecedor começa com esse nome.'
              : 'Cadastre um fornecedor em Clientes e fornecedores.'}
          </Text>
        ) : (
          <View accessibilityRole="list">
            {items.map((s) => (
              <Touchable
                key={s.id}
                accessibilityRole="button"
                accessibilityLabel={`Escolher ${s.name}`}
                onPress={() => onPick(s)}
                pressStyle={(state: InteractionState) => [
                  styles.row,
                  (state.hovered || state.pressed) && styles.hover,
                  showFocusRing(state) && focusRing(),
                ]}
              >
                <Text variant="bodyStrong" numberOfLines={1}>
                  {s.name}
                </Text>
                {s.tradeName || s.document ? (
                  <Text variant="small" color={color.textSecondary} numberOfLines={1}>
                    {s.tradeName || formatDocument(s.document)}
                  </Text>
                ) : null}
              </Touchable>
            ))}
          </View>
        )}
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  body: { gap: space[3] },
  row: {
    minHeight: layout.hitTarget + 8,
    justifyContent: 'center',
    paddingVertical: space[2],
    paddingHorizontal: space[2],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  hover: { backgroundColor: 'rgba(17,17,17,0.03)' },
});
