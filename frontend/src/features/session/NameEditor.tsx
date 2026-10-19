import { useState } from 'react';
import { View } from 'react-native';
import { toApiError } from '@/api/errors';
import { personName } from '@/features/auth/schemas';
import { useSession } from '@/session/SessionContext';
import { space } from '@/theme';
import { Button, Dialog, TextField, useToast, type ButtonVariant } from '@/ui';
import { useUpdateMyName } from './profile';

/**
 * Nome da própria pessoa, usado na saudação e na lista de usuários. Abre um diálogo curto; ao
 * salvar, /me volta atualizado e a saudação muda sem recarregar.
 */
export function NameEditor({ variant = 'ghost' }: { variant?: ButtonVariant }) {
  const session = useSession();
  const toast = useToast();
  const current = session.me?.name ?? '';
  const save = useUpdateMyName();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setError(null);
    save.reset();
  };
  const submit = async () => {
    const parsed = personName.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Informe seu nome.');
      return;
    }
    setError(null);
    try {
      await save.mutateAsync(parsed.data);
      close();
      toast.show('Nome atualizado');
    } catch (e) {
      setError(toApiError(e).userMessage);
    }
  };
  if (!session.me) return null;
  return (
    <>
      <Button
        label={current ? 'Editar nome' : 'Informar nome'}
        variant={variant}
        size="sm"
        onPress={() => {
          setValue(current);
          setOpen(true);
        }}
      />
      <Dialog
        visible={open}
        title="Seu nome"
        description="Aparece na saudação do painel e na lista de usuários da empresa."
        onClose={close}
        actions={
          <>
            <Button label="Cancelar" variant="ghost" onPress={close} />
            <Button label="Salvar" loading={save.isPending} onPress={submit} />
          </>
        }
      >
        <View style={{ gap: space[3] }}>
          <TextField
            label="Nome e sobrenome"
            value={value}
            onChangeText={setValue}
            error={error ?? undefined}
            autoComplete="name"
            textContentType="name"
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={submit}
          />
        </View>
      </Dialog>
    </>
  );
}
