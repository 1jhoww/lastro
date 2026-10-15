import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { Customer } from '@/api/types';
import { useCustomerList } from '@/features/customers/api';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { color, layout, space } from '@/theme';
import { Alert, Button, Dialog, SearchField, Skeleton, Text } from '@/ui';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';

/**
 * Cliente do pedido: só ativos e, para o vendedor, só os da carteira (o servidor filtra).
 * Cliente desativado não aparece e o servidor recusa com CUSTOMER_INACTIVE se mudar depois.
 */
export function CustomerPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (customer: Customer) => void;
}) {
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search).trim();
  const { query, items } = useCustomerList({ q, status: 'active' });

  return (
    <Dialog
      visible={visible}
      title="Escolher cliente"
      description="Clientes ativos. A busca considera o início do nome."
      onClose={onClose}
      actions={<Button label="Fechar" variant="ghost" onPress={onClose} />}
    >
      <SearchField
        label="Buscar cliente"
        hideLabel
        placeholder="Buscar pelo início do nome"
        value={search}
        onChangeText={setSearch}
        autoFocus
      />
      {query.isError ? (
        <Alert tone="danger" title="Não foi possível carregar os clientes">
          {toApiError(query.error).userMessage}
        </Alert>
      ) : query.isPending ? (
        <View style={styles.loading} accessibilityLabel="Carregando">
          <Skeleton width="60%" height={16} />
          <Skeleton width="40%" />
        </View>
      ) : items.length === 0 ? (
        <Text variant="body" color={color.textSecondary}>
          {q ? 'Nenhum cliente começa com esse nome.' : 'Nenhum cliente ativo disponível.'}
        </Text>
      ) : (
        <View accessibilityRole="list">
          {items.map((c) => (
            <Touchable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={`Escolher ${c.name}`}
              onPress={() => onPick(c)}
              pressStyle={(s: InteractionState) => [
                styles.row,
                (s.hovered || s.pressed) && styles.hover,
                showFocusRing(s) && focusRing(),
              ]}
            >
              <Text variant="bodyStrong" numberOfLines={1}>
                {c.name}
              </Text>
              {c.tradeName ? (
                <Text variant="small" color={color.textSecondary} numberOfLines={1}>
                  {c.tradeName}
                </Text>
              ) : null}
            </Touchable>
          ))}
          {query.hasNextPage ? (
            <Button
              label="Carregar mais"
              size="sm"
              variant="outline"
              loading={query.isFetchingNextPage}
              onPress={() => query.fetchNextPage()}
            />
          ) : null}
        </View>
      )}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  loading: { gap: space[2] },
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
