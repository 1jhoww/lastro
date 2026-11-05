import { useState } from 'react';
import { router, type Href } from 'expo-router';
import { FieldRow, FormActions, FormBody, FormGroup } from '@/features/catalog/FormParts';
import { todayIn } from '@/features/orders/rules';
import { useTenant } from '@/features/session/useTenant';
import { Button, ChoiceChips, CurrencyInput, DateField, Select, TextField, useToast } from '@/ui';
import { useCreatePayable, useExpenseCategories } from './api';
import { CommandError } from './Parts';

type Kind = 'expense' | 'manual';
const kinds: { value: Kind; label: string }[] = [
  { value: 'expense', label: 'Despesa da operação' },
  { value: 'manual', label: 'Outro lançamento' },
];

/** Despesa avulsa ou lançamento manual; uma compra de mercadoria nasce em Compras. */
export function ExpenseForm() {
  const tenant = useTenant();
  const today = todayIn(tenant.data?.timezone);
  const toast = useToast();
  const categories = useExpenseCategories();
  const create = useCreatePayable();
  const [kind, setKind] = useState<Kind>('expense');
  const [description, setDescription] = useState('');
  const [beneficiaryName, setBeneficiary] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amountCents, setAmount] = useState(0);
  const [issueDate, setIssueDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const valid = description.trim().length >= 2 && amountCents > 0 && Boolean(dueDate);
  return (
    <FormBody>
      <CommandError error={create.error} title="Título não lançado" />
      <FormGroup title="Lançamento">
        <ChoiceChips label="Tipo" options={kinds} value={kind} onChange={setKind} />
        <FieldRow weights={[3, 2]}>
          <TextField
            label="Descrição"
            value={description}
            onChangeText={setDescription}
            maxLength={200}
            hint={
              kind === 'expense' ? 'Ex.: Conta de energia de outubro' : 'Ex.: Parcela de empréstimo'
            }
          />
          <TextField
            label="Beneficiário"
            value={beneficiaryName}
            onChangeText={setBeneficiary}
            maxLength={160}
            optional
          />
        </FieldRow>
        <FieldRow weights={[2, 2, 2, 3]}>
          <CurrencyInput label="Valor" value={amountCents} onChange={setAmount} />
          <DateField
            label="Emissão"
            value={issueDate || today}
            today={today}
            onChange={setIssueDate}
          />
          <DateField label="Vencimento" value={dueDate} today={today} onChange={setDueDate} />
          <Select
            label="Categoria"
            value={categoryId || null}
            options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            onChange={setCategoryId}
            optional
          />
        </FieldRow>
        <TextField
          label="Observações"
          value={notes}
          onChangeText={setNotes}
          maxLength={1000}
          optional
        />
      </FormGroup>
      <FormActions>
        <Button
          label="Cancelar"
          variant="ghost"
          onPress={() => router.back()}
          disabled={create.isPending}
        />
        <Button
          label="Lançar título"
          variant="strong"
          loading={create.isPending}
          disabled={!valid}
          onPress={() =>
            create.mutate(
              {
                kind,
                description: description.trim(),
                ...(beneficiaryName.trim() ? { beneficiaryName: beneficiaryName.trim() } : {}),
                ...(categoryId ? { categoryId } : {}),
                amountCents,
                ...(issueDate ? { issueDate } : {}),
                dueDate,
                ...(notes.trim() ? { notes: notes.trim() } : {}),
              },
              {
                onSuccess: (title) => {
                  toast.show('Título lançado');
                  router.replace(`/financeiro/pagar/${title.id}` as Href);
                },
              },
            )
          }
        />
      </FormActions>
    </FormBody>
  );
}
