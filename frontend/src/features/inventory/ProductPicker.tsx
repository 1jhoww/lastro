import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { toApiError } from '@/api/errors';
import type { InventoryItem } from '@/api/types';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { color, layout, space } from '@/theme';
import { Alert, Button, Dialog, SearchField, Skeleton, Text } from '@/ui';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';
import { useInventoryList } from './api';
import { qty } from './StockParts';

/**
 * Escolha do produto de uma movimentação: busca pelo início do nome na própria lista de saldos
 * (`GET /inventory`), mostrando unidade e disponível para conferir antes de escolher.
 */
export function ProductPicker({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (item: InventoryItem) => void;
}) {
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search).trim();
  const { query, items } = useInventoryList({ q, status: 'active', order: 'name' }, visible);

  return (
    <Dialog
      visible={visible}
      title="Escolher produto"
      description="Produtos ativos. A busca considera o início do nome."
      onClose={onClose}
      actions={<Button label="Fechar" variant="ghost" onPress={onClose} />}
    >
      <SearchField
        label="Buscar produto"
        hideLabel
        placeholder="Buscar pelo início do nome"
        value={search}
        onChangeText={setSearch}
        autoFocus
      />
      {query.isError ? (
        <Alert tone="danger" title="Não foi possível carregar os produtos">
          {toApiError(query.error).userMessage}
        </Alert>
      ) : query.isPending ? (
        <View style={styles.loading} accessibilityLabel="Carregando">
          <Skeleton width="60%" height={16} />
          <Skeleton width="40%" />
        </View>
      ) : items.length === 0 ? (
        <Text variant="body" color={color.textSecondary}>
          {q ? 'Nenhum produto começa com esse nome.' : 'Nenhum produto ativo cadastrado.'}
        </Text>
      ) : (
        <View accessibilityRole="list">
          {items.map((item) => (
            <Touchable
              key={item.productId}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${item.sku}`}
              onPress={() => onPick(item)}
              pressStyle={(s: InteractionState) => [
                styles.row,
                (s.hovered || s.pressed) && styles.hover,
                showFocusRing(s) && focusRing(),
              ]}
            >
              <View style={styles.flex}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {item.name}
                </Text>
                <Text variant="small" color={color.textSecondary} numberOfLines={1}>
                  {`${item.sku} · ${item.unit}`}
                </Text>
              </View>
              <Text variant="small" color={color.textSecondary}>
                {`${qty(item.available, item.unit)} disp.`}
              </Text>
            </Touchable>
          ))}
          {query.hasNextPage ? (
            <Button
              label="Carregar mais"
              variant="outline"
              size="sm"
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.hitTarget + 8,
    paddingVertical: space[2],
    paddingHorizontal: space[2],
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  hover: { backgroundColor: 'rgba(17,17,17,0.03)' },
  flex: { flex: 1, minWidth: 0 },
});
