import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toApiError } from '@/api/errors';
import type { Category } from '@/api/types';
import { FieldRow, FormActions, FormSection, SubmitError } from '@/features/catalog/FormParts';
import { unitLabel, type Unit } from '@/lib/quantity';
import { space } from '@/theme';
import { Button, CurrencyInput, Select, Switch, TextField } from '@/ui';
import { productFormSchema, units, type ProductFormValues } from './form';

type Props = {
  defaultValues: ProductFormValues;
  categories: Category[];
  /** Produto já movimentou estoque? Desconhecido no cadastro; o servidor responde UNIT_LOCKED. */
  editing: boolean;
  submitLabel: string;
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
 * Cadastro de produto. Não registra estoque: o mínimo é só a referência para o alerta de
 * reposição. Valores iniciais são lidos na montagem; para outra versão, troque a `key`.
 */
export function ProductForm({
  defaultValues,
  categories,
  editing,
  submitLabel,
  submitting,
  error,
  onSubmit,
  onCancel,
  onReload,
}: Props) {
  const { control, handleSubmit, setError } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const unit = useWatch({ control, name: 'unit' }) as Unit;
  const fieldError = error ? fieldErrors[toApiError(error).code] : undefined;

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
  const submit = handleSubmit(onSubmit);

  return (
    <View style={styles.root}>
      {error && !fieldError ? <SubmitError error={error} onReload={onReload} /> : null}

      <FormSection title="Identificação">
        <FieldRow weights={[3, 2]}>
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
                hint="Código único na empresa. Salvo em maiúsculas."
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                autoCapitalize="characters"
                autoCorrect={false}
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
      </FormSection>

      <FormSection title="Venda">
        <FieldRow>
          <Controller
            control={control}
            name="unit"
            render={({ field, fieldState }) => (
              <Select
                label="Unidade"
                value={field.value}
                options={units}
                onChange={field.onChange}
                error={fieldState.error?.message}
                hint={
                  editing
                    ? 'Não muda depois da primeira movimentação de estoque.'
                    : 'KG e L aceitam até 3 casas decimais; as demais, só inteiros.'
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
                hint="Preço de tabela. O pedido usa o preço vigente na confirmação."
              />
            )}
          />
        </FieldRow>
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
      </FormSection>

      <FormSection title="Catálogo e reposição">
        <Controller
          control={control}
          name="catalogVisible"
          render={({ field }) => (
            <Switch
              label="Mostrar no catálogo público"
              description="Só aparece quando o catálogo público da empresa estiver ativado."
              value={field.value}
              onChange={field.onChange}
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
              hint={`Em ${unitLabel[unit]}. Abaixo disso, o produto entra na lista de reposição. Não altera o saldo.`}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              inputMode={unit === 'KG' || unit === 'L' ? 'decimal' : 'numeric'}
              placeholder="0"
            />
          )}
        />
      </FormSection>

      <FormActions>
        <Button label="Cancelar" variant="ghost" onPress={onCancel} disabled={submitting} />
        <Button label={submitLabel} variant="strong" loading={submitting} onPress={submit} />
      </FormActions>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[5] },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
});
