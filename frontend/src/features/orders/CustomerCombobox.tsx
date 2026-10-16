import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View, type TextInput } from 'react-native';
import { toApiError } from '@/api/errors';
import type { Customer } from '@/api/types';
import { useCustomerList } from '@/features/customers/api';
import { customerSubtitle } from '@/features/customers/presentation';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { color, elevation, layout, radius, space, useLayoutSize } from '@/theme';
import { Button, SearchField, Skeleton, Text } from '@/ui';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';

export type PickedCustomer = { id: string; name: string; detail?: string };

/** Fantasia, documento formatado e cidade/UF como identificação secundária, quando cadastrados. */
export function customerDetail(c: Customer): string | undefined {
  return customerSubtitle(c) || undefined;
}

/** Atraso para o toque em um resultado chegar antes de o campo perder o foco e fechar a lista. */
const BLUR_DELAY = 180;

/**
 * Cliente do pedido como combobox: busca sempre visível, resultados logo abaixo e seleção com um
 * toque. Só ativos e, para o vendedor, só os da carteira (o servidor filtra). Escolhido o cliente,
 * o campo mostra o nome com a opção de trocar; trocar sem escolher outro mantém o atual.
 */
export function CustomerCombobox({
  value,
  onChange,
  disabled,
}: {
  value: PickedCustomer | null;
  onChange: (customer: PickedCustomer) => void;
  disabled?: boolean;
}) {
  const compact = useLayoutSize() === 'compact';
  const [editing, setEditing] = useState(!value);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search).trim();
  const { query, items } = useCustomerList({ q, status: 'active' });
  const input = useRef<TextInput>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (closing.current && clearTimeout(closing.current)), []);

  const pick = (c: Customer) => {
    if (closing.current) clearTimeout(closing.current);
    onChange({ id: c.id, name: c.name, detail: customerDetail(c) });
    setSearch('');
    setOpen(false);
    setEditing(false);
  };

  if (value && !editing)
    return (
      <View style={styles.root}>
        <Text variant="smallStrong">Cliente</Text>
        <View style={[styles.chosen, disabled && styles.disabled]}>
          <View style={styles.flex}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {value.name}
            </Text>
            {value.detail ? (
              <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
                {value.detail}
              </Text>
            ) : null}
          </View>
          <Button
            label="Trocar"
            accessibilityLabel={`Trocar cliente ${value.name}`}
            size="sm"
            variant="ghost"
            disabled={disabled}
            onPress={() => {
              setEditing(true);
              setOpen(true);
            }}
          />
        </View>
      </View>
    );

  const list = (
    <View
      style={[styles.dropdown, !compact && styles.floating]}
      accessibilityRole="list"
      accessibilityLabel="Clientes encontrados"
    >
      {query.isError ? (
        <Text variant="small" color={color.danger} style={styles.message}>
          {toApiError(query.error).userMessage}
        </Text>
      ) : query.isPending ? (
        <View style={[styles.message, { gap: space[2] }]} accessibilityLabel="Carregando">
          <Skeleton width="60%" height={14} />
          <Skeleton width="40%" />
        </View>
      ) : items.length === 0 ? (
        <Text variant="small" color={color.textSecondary} style={styles.message}>
          {q ? 'Nenhum cliente começa com esse nome.' : 'Nenhum cliente ativo disponível.'}
        </Text>
      ) : (
        <>
          {items.map((c) => {
            const detail = customerDetail(c);
            return (
              <Touchable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={`Escolher ${c.name}`}
                onPress={() => pick(c)}
                pressStyle={(s: InteractionState) => [
                  styles.option,
                  (s.hovered || s.pressed) && styles.hover,
                  showFocusRing(s) && focusRing(),
                ]}
              >
                <Text variant="bodyStrong" numberOfLines={1}>
                  {c.name}
                </Text>
                {detail ? (
                  <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
                    {detail}
                  </Text>
                ) : null}
              </Touchable>
            );
          })}
          {query.hasNextPage ? (
            <View style={styles.more}>
              <Button
                label="Mais clientes"
                size="sm"
                variant="ghost"
                loading={query.isFetchingNextPage}
                onPress={() => {
                  if (closing.current) clearTimeout(closing.current);
                  input.current?.focus();
                  query.fetchNextPage();
                }}
              />
            </View>
          ) : null}
        </>
      )}
    </View>
  );

  return (
    <View style={[styles.root, open && styles.raised]}>
      <SearchField
        ref={input}
        label="Cliente"
        placeholder="Buscar cliente pelo início do nome"
        value={search}
        editable={!disabled}
        autoFocus={editing && Boolean(value)}
        onChangeText={(text) => {
          setSearch(text);
          setOpen(true);
        }}
        onFocus={() => {
          if (closing.current) clearTimeout(closing.current);
          setOpen(true);
        }}
        onBlur={() => {
          closing.current = setTimeout(() => {
            setOpen(false);
            // Trocar sem escolher: volta ao cliente atual.
            if (value) {
              setEditing(false);
              setSearch('');
            }
          }, BLUR_DELAY);
        }}
        onKeyPress={
          Platform.OS === 'web'
            ? (e) => {
                if ((e.nativeEvent as { key?: string }).key === 'Escape') input.current?.blur();
              }
            : undefined
        }
      />
      {open ? list : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[2], alignSelf: 'stretch' },
  // Lista flutuante precisa ficar acima das seções seguintes.
  raised: { zIndex: 20 },
  flex: { flex: 1, minWidth: 0 },
  chosen: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingLeft: space[3],
    paddingRight: space[1],
    paddingVertical: space[1],
    borderWidth: 1,
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    backgroundColor: color.surface,
  },
  disabled: { backgroundColor: color.surfaceSunken },
  dropdown: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    paddingVertical: space[1],
    overflow: 'hidden',
  },
  floating: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: space[1],
    maxHeight: 360,
    overflow: 'scroll' as 'hidden',
    ...elevation.overlay,
  },
  option: {
    minHeight: layout.hitTarget,
    justifyContent: 'center',
    paddingVertical: space[2],
    paddingHorizontal: space[3],
  },
  hover: { backgroundColor: 'rgba(17,17,17,0.04)' },
  message: { paddingVertical: space[3], paddingHorizontal: space[3] },
  more: { paddingHorizontal: space[2], paddingTop: space[1], alignItems: 'flex-start' },
});
