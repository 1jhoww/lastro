import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toApiError } from '@/api/errors';
import type { Category } from '@/api/types';
import {
  FieldRow,
  FormActions,
  FormBody,
  FormGroup,
  SubmitError,
} from '@/features/catalog/FormParts';
import { useDiscardGuard } from '@/features/catalog/useDiscardGuard';
import { unitLabel, type Unit } from '@/lib/quantity';
import { space, useLayoutSize } from '@/theme';
import { Button, ConfirmDialog, CurrencyInput, Select, Switch, TextField } from '@/ui';
import { productFormSchema, units, type ProductFormValues } from './form';

type Props = {
  defaultValues: ProductFormValues;
  categories: Category[];
  /** Edição: mostra a situação e avisa sobre a unidade travada pelo estoque. */
  editing: boolean;
  /** Bloco "Imagem": editor imediato (edição) ou escolha pendente (cadastro). */
  image: ReactNode;
  submitting: boolean;
  error: unknown;
  onSubmit: (values: ProductFormValues) => void;
  onCancel: () => void;
  onReload?: () => void;
};

const fieldErrors: Record<string, { field: keyof ProductFormValues; message: string }> = {
  DUPLICATE_SKU: { field: 'sku', message: 'Já existe um produto com este SKU nesta empresa.' },
  INVALID_CATEGORY: {
    field: 'categoryId',
    message: 'Esta categoria está inativa ou foi removida. Escolha outra.',
  },
  UNIT_LOCKED: {
    field: 'unit',
    message: 'A unidade não pode mudar: o produto já tem movimentação de estoque.',
  },
  INVALID_PRECISION: {
    field: 'minimumStock',
    message: 'Esta unidade não aceita essa quantidade de casas decimais.',
  },
};

/**
 * Cadastro de produto, o mesmo para criar e editar: informações, comercial e imagem. Não
 * registra estoque: o mínimo é só a referência para o alerta de reposição. Preço é o de
 * tabela; pedidos já registrados guardam o próprio preço e não mudam com esta edição.
 * Valores iniciais são lidos na montagem; para outra versão, troque a `key`.
 */
export function ProductForm({
  defaultValues,
  categories,
  editing,
  image,
  submitting,
  error,
  onSubmit,
  onCancel,
  onReload,
}: Props) {
  const wide = useLayoutSize() === 'expanded';
  const { control, handleSubmit, setError, formState } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const unit = useWatch({ control, name: 'unit' }) as Unit;
  const fieldError = error ? fieldErrors[toApiError(error).code] : undefined;
  const guard = useDiscardGuard(formState.isDirty && !submitting, onCancel);
  const [confirmInactive, setConfirmInactive] = useState<ProductFormValues | null>(null);

  useEffect(() => {
    if (fieldError) setError(fieldError.field, { message: fieldError.message });
  }, [fieldError, setError]);

  const categoryOptions = [
    { value: 'none', label: 'Sem categoria' },
    ...categories
      .filter((c) => c.status === 'active' || c.id === defaultValues.categoryId)
      .map((c) => ({
        value: c.id,
        label: c.status === 'active' ? c.name : `${c.name} (inativa)`,
      })),
  ];
  // Desativar pelo formulário pede a mesma confirmação da ficha.
  const submit = handleSubmit((values) => {
    if (editing && defaultValues.status === 'active' && values.status === 'inactive')
      setConfirmInactive(values);
    else onSubmit(values);
  });

  const details = (
    <>
      <FormGroup title="Informações">
        <FieldRow weights={[3, 2, 2]}>
          <Controller
            control={control}
            name="name"
            render={({ field, fieldState }) => (
              <TextField
                label="Nome do produto"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="sku"
            render={({ field, fieldState }) => (
              <TextField
                label="SKU"
                hint="Código único. Salvo em maiúsculas."
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            )}
          />
          <Controller
            control={control}
            name="categoryId"
            render={({ field, fieldState }) => (
              <Select
                label="Categoria"
                optional
                value={field.value ?? 'none'}
                options={categoryOptions}
                onChange={(v) => field.onChange(v === 'none' ? null : v)}
                error={fieldState.error?.message}
              />
            )}
          />
        </FieldRow>
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
      </FormGroup>

      <FormGroup title="Comercial">
        <FieldRow weights={[2, 2, 2]}>
          <Controller
            control={control}
            name="unit"
            render={({ field, fieldState }) => (
              <Select
                label="Unidade de venda"
                value={field.value}
                options={units}
                onChange={field.onChange}
                error={fieldState.error?.message}
                hint={
                  editing
                    ? 'Não muda depois da primeira movimentação de estoque.'
                    : 'KG e L aceitam até 3 casas; as demais, só inteiros. Depois da primeira entrada de estoque, a unidade não muda mais.'
                }
              />
            )}
          />
          <Controller
            control={control}
            name="priceCents"
            render={({ field, fieldState }) => (
              <CurrencyInput
                label={`Preço por ${unitLabel[unit]}`}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                hint="Pedidos já registrados mantêm o preço deles."
              />
            )}
          />
          <Controller
            control={control}
            name="minimumStock"
            render={({ field, fieldState }) => (
              <TextField
                label="Estoque mínimo"
                optional
                hint={`Em ${unitLabel[unit]}. Só alerta reposição; não altera o saldo.`}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                inputMode={unit === 'KG' || unit === 'L' ? 'decimal' : 'numeric'}
                placeholder="0"
              />
            )}
          />
        </FieldRow>
        <FieldRow>
          {editing ? (
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <Switch
                  label="Produto ativo"
                  description={
                    field.value === 'active'
                      ? 'Disponível para vendedores e novos pedidos.'
                      : 'Inativo: some para vendedores e não entra em novos pedidos.'
                  }
                  value={field.value === 'active'}
                  onChange={(on) => field.onChange(on ? 'active' : 'inactive')}
                />
              )}
            />
          ) : null}
          <Controller
            control={control}
            name="catalogVisible"
            render={({ field }) => (
              <Switch
                label="Visível no catálogo público"
                description={
                  field.value
                    ? 'Aparece no catálogo quando ele estiver ativado e o produto, ativo.'
                    : 'Oculto do catálogo público; segue disponível no app.'
                }
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </FieldRow>
      </FormGroup>
    </>
  );

  const imageGroup = (
    <FormGroup title="Imagem">
      <View style={wide ? undefined : styles.imageNarrow}>{image}</View>
    </FormGroup>
  );

  return (
    <FormBody>
      {error && !fieldError ? <SubmitError error={error} onReload={onReload} /> : null}
      {wide ? (
        <View style={styles.columns}>
          <View style={styles.main}>{details}</View>
          <View style={styles.aside}>{imageGroup}</View>
        </View>
      ) : (
        <>
          {details}
          {imageGroup}
        </>
      )}
      <FormActions>
        <Button label="Cancelar" variant="ghost" onPress={guard.cancel} disabled={submitting} />
        <Button label="Salvar produto" variant="strong" loading={submitting} onPress={submit} />
      </FormActions>
      {guard.dialog}
      <ConfirmDialog
        visible={confirmInactive !== null}
        title="Desativar produto?"
        description="O produto some para vendedores e do catálogo, e não entra em novos pedidos. Saldo, histórico e pedidos antigos ficam preservados; você pode reativar depois."
        confirmLabel="Salvar e desativar"
        onCancel={() => setConfirmInactive(null)}
        onConfirm={() => {
          const values = confirmInactive;
          setConfirmInactive(null);
          if (values) onSubmit(values);
        }}
      />
    </FormBody>
  );
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: space[8] },
  main: { flex: 1, minWidth: 0, gap: space[8] },
  aside: { width: 300 },
  imageNarrow: { maxWidth: 320 },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
});
