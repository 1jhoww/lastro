import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, type TextInput } from 'react-native';
import {
  Controller,
  useForm,
  useWatch,
  type Control,
  type FieldPath,
  type UseFormReturn,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toApiError } from '@/api/errors';
import {
  FieldRow,
  FormActions,
  FormBody,
  FormGroup,
  SubmitError,
} from '@/features/catalog/FormParts';
import { useDiscardGuard } from '@/features/catalog/useDiscardGuard';
import { brazilianStates, maskPhone, maskPostalCode } from '@/lib/document';
import { color, space } from '@/theme';
import { Alert, Button, Checkbox, Select, TextField, type TextFieldProps } from '@/ui';
import { CircleCheck } from '@/ui/icons';
import { customerFormSchema, type CustomerFormValues } from './form';
import { lookupPostalCode, type PostalCodeAddress, type PostalCodeResult } from './viaCep';

type Props = {
  defaultValues: CustomerFormValues;
  submitting: boolean;
  error: unknown;
  onSubmit: (values: CustomerFormValues) => void;
  onCancel: () => void;
  onReload?: () => void;
  /** Cliente antigo, gravado antes da obrigatoriedade do endereço: pede a complementação. */
  incompleteAddress?: boolean;
};

const stateOptions = brazilianStates.map((uf) => ({ value: uf, label: uf }));

/**
 * Formulário de cliente, o mesmo para cadastrar e editar. Obrigatórios: nome e endereço (menos
 * complemento); CPF/CNPJ é opcional. O CEP completo consulta o ViaCEP e sugere logradouro,
 * bairro, cidade e UF sem apagar o que a pessoa já digitou. Erros de unicidade do servidor
 * voltam para o campo certo.
 *
 * Valores iniciais só são lidos na montagem: para recarregar outra versão, troque a `key`.
 */
export function CustomerForm({
  defaultValues,
  submitting,
  error,
  onSubmit,
  onCancel,
  onReload,
  incompleteAddress,
}: Props) {
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const { control, handleSubmit, setError, formState } = form;
  const numberRef = useRef<TextInput>(null);
  const cep = usePostalCodeAutofill(form, defaultValues.postalCode, () => {
    if (!form.getValues('number') && !form.getValues('noNumber')) numberRef.current?.focus();
  });
  const noNumber = useWatch({ control, name: 'noNumber' });
  const guard = useDiscardGuard(formState.isDirty && !submitting, onCancel);

  useEffect(() => {
    if (!error) return;
    if (toApiError(error).code === 'DUPLICATE_DOCUMENT')
      setError('document', { message: 'Já existe um cliente com este CPF/CNPJ nesta empresa.' });
  }, [error, setError]);

  const submit = handleSubmit(onSubmit);
  const showBanner = error && toApiError(error).code !== 'DUPLICATE_DOCUMENT';

  return (
    <FormBody>
      {showBanner ? <SubmitError error={error} onReload={onReload} /> : null}

      <FormGroup title="Identificação">
        <FieldRow weights={[3, 2, 2]}>
          <Field
            control={control}
            name="name"
            label="Nome ou razão social"
            autoCapitalize="words"
          />
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
            hint="Só os dígitos são validados."
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </FieldRow>
      </FormGroup>

      <FormGroup title="Contato">
        <FieldRow weights={[2, 3]}>
          <Field
            control={control}
            name="phone"
            label="Telefone ou WhatsApp"
            optional
            inputMode="tel"
            autoComplete="tel"
            placeholder="(11) 98765-4321"
            mask={maskPhone}
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
        <Field
          control={control}
          name="notes"
          label="Observações"
          optional
          multiline
          numberOfLines={2}
          placeholder="Horário de entrega, contato preferido, combinados."
        />
      </FormGroup>

      <FormGroup title="Endereço" description="Obrigatório. Só o complemento é opcional.">
        {incompleteAddress ? (
          <Alert tone="warning" title="Endereço incompleto">
            Este cadastro é anterior à obrigatoriedade do endereço. Complete os campos para salvar.
          </Alert>
        ) : null}
        <FieldRow weights={[1, 3]}>
          <Field
            control={control}
            name="postalCode"
            label="CEP"
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="00000-000"
            maxLength={9}
            mask={maskPostalCode}
            onValueChange={cep.onPostalCodeChange}
            hint={cep.hint}
            trailing={
              cep.status === 'loading' ? (
                <ActivityIndicator
                  size="small"
                  color={color.textSecondary}
                  accessibilityLabel="Consultando CEP"
                />
              ) : cep.status === 'found' ? (
                <CircleCheck
                  size={18}
                  color={color.success}
                  strokeWidth={2}
                  accessibilityLabel="CEP encontrado"
                />
              ) : null
            }
          />
          <Field control={control} name="street" label="Logradouro" autoCapitalize="words" />
        </FieldRow>
        <FieldRow weights={[1, 2, 2]}>
          <View style={styles.number}>
            <Field
              control={control}
              name="number"
              label="Número"
              ref={numberRef}
              editable={!noNumber}
              placeholder={noNumber ? 'S/N' : undefined}
            />
            <Controller
              control={control}
              name="noNumber"
              render={({ field }) => (
                <Checkbox
                  label="Sem número"
                  checked={field.value}
                  onChange={(checked) => {
                    field.onChange(checked);
                    if (checked)
                      form.setValue('number', '', {
                        shouldDirty: true,
                        shouldValidate: formState.isSubmitted,
                      });
                    else if (formState.isSubmitted) form.trigger('number');
                  }}
                />
              )}
            />
          </View>
          <Field control={control} name="complement" label="Complemento" optional />
          <Field control={control} name="district" label="Bairro" autoCapitalize="words" />
        </FieldRow>
        <FieldRow weights={[3, 1]}>
          <Field control={control} name="city" label="Cidade" autoCapitalize="words" />
          <Controller
            control={control}
            name="state"
            render={({ field, fieldState }) => (
              <Select
                label="UF"
                value={field.value || null}
                options={stateOptions}
                placeholder="UF"
                onChange={field.onChange}
                error={fieldState.error?.message}
              />
            )}
          />
        </FieldRow>
      </FormGroup>

      <FormActions>
        <Button label="Cancelar" variant="ghost" onPress={guard.cancel} disabled={submitting} />
        <Button label="Salvar cliente" variant="strong" loading={submitting} onPress={submit} />
      </FormActions>
      {guard.dialog}
    </FormBody>
  );
}

type AddressField = keyof PostalCodeAddress;
const addressFields: AddressField[] = ['street', 'district', 'city', 'state'];
type CepStatus = 'idle' | 'loading' | PostalCodeResult['kind'];

/**
 * Consulta o ViaCEP quando o CEP fica completo, a partir da digitação (nunca na montagem).
 * Regras:
 * - CEP inicial (edição) não é consultado de novo enquanto não mudar;
 * - nova digitação cancela a consulta anterior, e resposta de um CEP que já mudou é descartada;
 * - um campo só é preenchido se estiver vazio ou ainda com o valor que a consulta anterior pôs,
 *   para nunca sobrescrever o que a pessoa digitou.
 */
function usePostalCodeAutofill(
  form: UseFormReturn<CustomerFormValues>,
  initialPostalCode: string,
  onFilled: () => void,
) {
  const [status, setStatus] = useState<CepStatus>('idle');
  const queried = useRef(initialPostalCode.replace(/\D/g, ''));
  const pending = useRef<AbortController | null>(null);
  const filled = useRef<Partial<Record<AddressField, string>>>({});

  useEffect(() => () => pending.current?.abort(), []);

  const onPostalCodeChange = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 8) {
      pending.current?.abort();
      queried.current = '';
      setStatus('idle');
      return;
    }
    if (digits === queried.current) return;
    queried.current = digits;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setStatus('loading');
    lookupPostalCode(digits, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (form.getValues('postalCode').replace(/\D/g, '') !== digits) return;
        setStatus(result.kind);
        if (result.kind !== 'found') return;
        const submitted = form.formState.isSubmitted;
        for (const field of addressFields) {
          const next = result.address[field];
          if (!next) continue;
          const current = form.getValues(field);
          if (current.trim() && current !== filled.current[field]) continue;
          form.setValue(field, next, { shouldDirty: true, shouldValidate: submitted });
          filled.current[field] = next;
        }
        onFilled();
      })
      .catch(() => {});
  };

  const hint =
    status === 'notFound'
      ? 'CEP não encontrado. Preencha o endereço manualmente.'
      : status === 'unavailable'
        ? 'Consulta de CEP indisponível agora. Preencha manualmente.'
        : undefined;
  return { status, hint, onPostalCodeChange };
}

type FieldProps = {
  control: Control<CustomerFormValues>;
  name: Exclude<FieldPath<CustomerFormValues>, 'noNumber'>;
  /** Formata enquanto digita (CEP, telefone). */
  mask?: (value: string) => string;
  /** Recebe o valor já formatado, depois de gravado no formulário. */
  onValueChange?: (value: string) => void;
} & Omit<TextFieldProps, 'value' | 'onChangeText'>;

function Field({ control, name, mask, onValueChange, ...rest }: FieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          {...rest}
          value={field.value}
          onChangeText={(text) => {
            const value = mask ? mask(text) : text;
            field.onChange(value);
            onValueChange?.(value);
          }}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
          style={rest.multiline ? styles.multiline : undefined}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  number: { gap: space[1] },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
});
