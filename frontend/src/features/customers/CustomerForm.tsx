import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Controller, useForm, type Control, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toApiError } from '@/api/errors';
import { FieldRow, FormActions, FormSection, SubmitError } from '@/features/catalog/FormParts';
import { space } from '@/theme';
import { Button, TextField, type TextFieldProps } from '@/ui';
import { customerFormSchema, type CustomerFormValues } from './form';

type Props = {
  defaultValues: CustomerFormValues;
  submitLabel: string;
  submitting: boolean;
  error: unknown;
  onSubmit: (values: CustomerFormValues) => void;
  onCancel: () => void;
  onReload?: () => void;
};

/**
 * Formulário de cliente (criar e editar). Só o nome é obrigatório; o resto pode ser completado
 * depois. Erros de unicidade do servidor voltam para o campo certo.
 *
 * Valores iniciais só são lidos na montagem: para recarregar outra versão, troque a `key`.
 */
export function CustomerForm({
  defaultValues,
  submitLabel,
  submitting,
  error,
  onSubmit,
  onCancel,
  onReload,
}: Props) {
  const { control, handleSubmit, setError } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  useEffect(() => {
    if (!error) return;
    if (toApiError(error).code === 'DUPLICATE_DOCUMENT')
      setError('document', { message: 'Já existe um cliente com este CPF/CNPJ nesta empresa.' });
  }, [error, setError]);

  const submit = handleSubmit(onSubmit);
  const showBanner = error && toApiError(error).code !== 'DUPLICATE_DOCUMENT';

  return (
    <View style={styles.root}>
      {showBanner ? <SubmitError error={error} onReload={onReload} /> : null}
      <FormSection title="Identificação">
        <Field control={control} name="name" label="Nome ou razão social" autoCapitalize="words" />
        <FieldRow weights={[3, 2]}>
          <Field
            control={control}
            name="tradeName"
            label="Nome fantasia"
            optional
            autoCapitalize="words"
          />
          <Field
            control={control}
            name="document"
            label="CPF ou CNPJ"
            optional
            hint="Só validamos os dígitos; não consultamos a Receita."
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </FieldRow>
      </FormSection>

      <FormSection title="Contato">
        <FieldRow>
          <Field
            control={control}
            name="phone"
            label="Telefone"
            optional
            inputMode="tel"
            autoComplete="tel"
          />
          <Field
            control={control}
            name="email"
            label="E-mail"
            optional
            inputMode="email"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
          />
        </FieldRow>
      </FormSection>

      <FormSection title="Endereço" description="Opcional. Preencha o que tiver.">
        <FieldRow weights={[1, 2]}>
          <Field control={control} name="postalCode" label="CEP" optional inputMode="numeric" />
          <Field control={control} name="city" label="Cidade" optional autoCapitalize="words" />
        </FieldRow>
        <FieldRow weights={[3, 1]}>
          <Field control={control} name="street" label="Rua" optional autoCapitalize="words" />
          <Field control={control} name="number" label="Número" optional />
        </FieldRow>
        <FieldRow weights={[2, 2, 1]}>
          <Field control={control} name="complement" label="Complemento" optional />
          <Field control={control} name="district" label="Bairro" optional autoCapitalize="words" />
          <Field
            control={control}
            name="state"
            label="UF"
            optional
            autoCapitalize="characters"
            maxLength={2}
          />
        </FieldRow>
      </FormSection>

      <FormSection title="Observações">
        <Field
          control={control}
          name="notes"
          label="Observações"
          hideLabel
          optional
          multiline
          numberOfLines={4}
          placeholder="Horário de entrega, contato preferido, combinados."
        />
      </FormSection>

      <FormActions>
        <Button label="Cancelar" variant="ghost" onPress={onCancel} disabled={submitting} />
        <Button label={submitLabel} variant="strong" loading={submitting} onPress={submit} />
      </FormActions>
    </View>
  );
}

function Field({
  control,
  name,
  ...rest
}: { control: Control<CustomerFormValues>; name: FieldPath<CustomerFormValues> } & Omit<
  TextFieldProps,
  'value' | 'onChangeText'
>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          {...rest}
          value={field.value}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
          style={rest.multiline ? styles.multiline : undefined}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  root: { gap: space[5] },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
});
