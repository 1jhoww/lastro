import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toApiError } from '@/api/errors';
import type { Category, StatusFilter } from '@/api/types';
import {
  useCategoryList,
  useCreateCategory,
  useSetCategoryStatus,
  useUpdateCategory,
} from '@/features/categories/api';
import { ListPanel } from '@/features/catalog/ListStates';
import { RequirePermission } from '@/features/session/RequirePermission';
import { Screen } from '@/layout/Screen';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { color, space, useLayoutSize } from '@/theme';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  SearchField,
  Segmented,
  Text,
  TextField,
  useToast,
} from '@/ui';
import { Plus, SearchX, Tags } from '@/ui/icons';

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Informe o nome com pelo menos 2 caracteres.')
    .max(160, 'Use até 160 caracteres.'),
  description: z.string().trim().max(1000, 'Use até 1000 caracteres.'),
});
type Values = z.infer<typeof schema>;

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Ativas' },
  { value: 'inactive', label: 'Inativas' },
  { value: 'all', label: 'Todas' },
];

export default function CategoriesRoute() {
  return (
    <RequirePermission title="Categorias" anyOf={['products:manage']}>
      <Categories />
    </RequirePermission>
  );
}

function Categories() {
  const compact = useLayoutSize() === 'compact';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const q = useDebouncedValue(search);
  const filters = useMemo(() => ({ q, status }), [q, status]);
  const { query, items } = useCategoryList(filters);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [toggling, setToggling] = useState<Category | null>(null);
  const setCategoryStatus = useSetCategoryStatus();
  const toast = useToast();

  return (
    <Screen
      title="Categorias"
      description="Agrupam produtos nas listas e no catálogo."
      actions={
        <Button
          label="Nova categoria"
          icon={Plus}
          variant="strong"
          fullWidth={compact}
          onPress={() => setEditing('new')}
        />
      }
    >
      <View style={[styles.toolbar, compact && styles.toolbarCompact]}>
        <View style={styles.search}>
          <SearchField
            label="Buscar categorias"
            hideLabel
            placeholder="Buscar pelo início do nome"
            value={search}
            onChangeText={setSearch}
          />
        </View>
        <Segmented label="Situação" options={statusOptions} value={status} onChange={setStatus} />
      </View>
      {setCategoryStatus.isError ? (
        <Alert tone="danger" title="Situação não alterada">
          {toApiError(setCategoryStatus.error).code === 'CONFLICT'
            ? 'A categoria mudou enquanto você decidia. A lista foi atualizada; tente de novo.'
            : toApiError(setCategoryStatus.error).userMessage}
        </Alert>
      ) : null}

      <ListPanel
        query={query}
        count={items.length}
        empty={
          q.trim() || status !== 'active' ? (
            <EmptyState icon={SearchX} title="Nenhuma categoria encontrada" />
          ) : (
            <EmptyState
              icon={Tags}
              title="Nenhuma categoria ainda"
              description="Categorias ajudam a filtrar produtos. São opcionais."
              action={
                <Button
                  label="Nova categoria"
                  icon={Plus}
                  variant="strong"
                  onPress={() => setEditing('new')}
                />
              }
            />
          )
        }
      >
        {items.map((c, i) => (
          <View key={c.id} style={[styles.row, i < items.length - 1 && styles.divider]}>
            <View style={styles.copy}>
              <View style={styles.titleRow}>
                <Text variant="bodyStrong">{c.name}</Text>
                {c.status === 'inactive' ? <Badge label="Inativa" /> : null}
              </View>
              {c.description ? (
                <Text variant="small" color={color.textSecondary} numberOfLines={2}>
                  {c.description}
                </Text>
              ) : null}
            </View>
            <View style={styles.actions}>
              <Button label="Editar" size="sm" variant="outline" onPress={() => setEditing(c)} />
              <Button
                label={c.status === 'active' ? 'Desativar' : 'Reativar'}
                size="sm"
                variant="ghost"
                onPress={() => setToggling(c)}
              />
            </View>
          </View>
        ))}
      </ListPanel>

      {editing ? (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <ConfirmDialog
        visible={toggling !== null}
        title={toggling?.status === 'active' ? 'Desativar categoria?' : 'Reativar categoria?'}
        description={
          toggling?.status === 'active'
            ? 'Produtos que já estão nela continuam com a categoria. Ela só deixa de aparecer para novos cadastros e filtros do vendedor.'
            : 'A categoria volta a aceitar produtos.'
        }
        confirmLabel={toggling?.status === 'active' ? 'Desativar categoria' : 'Reativar categoria'}
        tone={toggling?.status === 'active' ? 'danger' : 'strong'}
        loading={setCategoryStatus.isPending}
        onCancel={() => setToggling(null)}
        onConfirm={() => {
          if (!toggling) return;
          const activate = toggling.status !== 'active';
          setCategoryStatus.mutate(
            { id: toggling.id, active: activate, expectedVersion: toggling.version },
            {
              onSuccess: () =>
                toast.show(activate ? 'Categoria reativada' : 'Categoria desativada'),
              onSettled: () => setToggling(null),
            },
          );
        }}
      />
    </Screen>
  );
}

function CategoryDialog({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const toast = useToast();
  const mutation = category ? update : create;
  const { control, handleSubmit } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: category?.name ?? '', description: category?.description ?? '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const submit = handleSubmit((v) => {
    const description = v.description.trim();
    if (category)
      update.mutate(
        {
          id: category.id,
          body: { name: v.name.trim(), description, expectedVersion: category.version },
        },
        {
          onSuccess: () => {
            toast.show('Categoria salva');
            onClose();
          },
        },
      );
    else
      create.mutate(
        { name: v.name.trim(), ...(description ? { description } : {}) },
        {
          onSuccess: () => {
            toast.show('Categoria criada');
            onClose();
          },
        },
      );
  });
  const err = mutation.error ? toApiError(mutation.error) : null;

  return (
    <Dialog
      visible
      title={category ? 'Editar categoria' : 'Nova categoria'}
      onClose={mutation.isPending ? () => {} : onClose}
      actions={
        <>
          <Button
            label="Cancelar"
            variant="ghost"
            onPress={onClose}
            disabled={mutation.isPending}
          />
          <Button
            label={category ? 'Salvar' : 'Criar categoria'}
            variant="strong"
            loading={mutation.isPending}
            onPress={submit}
          />
        </>
      }
    >
      {err ? (
        <Alert tone="danger" title="Não foi possível salvar">
          {err.code === 'CONFLICT'
            ? 'Esta categoria foi alterada por outra pessoa. Feche e abra de novo para ver a versão atual.'
            : err.userMessage}
        </Alert>
      ) : null}
      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <TextField
            label="Nome"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            autoFocus
          />
        )}
      />
      <Controller
        control={control}
        name="description"
        render={({ field, fieldState }) => (
          <TextField
            label="Descrição"
            optional
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            multiline
            numberOfLines={3}
            style={styles.multiline}
          />
        )}
      />
    </Dialog>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexWrap: 'wrap' },
  toolbarCompact: { flexDirection: 'column', alignItems: 'stretch', flexWrap: 'nowrap' },
  search: { flex: 1, minWidth: 240 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
  },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  copy: { flex: 1, minWidth: 200, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  actions: { flexDirection: 'row', gap: space[2] },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
});
