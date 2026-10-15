import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

type Props = {
  visible: boolean;
  title: string;
  description: string;
  /** Rótulo da ação, com o verbo do que acontece ("Desativar cliente"). */
  confirmLabel: string;
  tone?: 'danger' | 'strong';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
};

/** Confirmação antes de ações que mudam a situação de um registro. */
export function ConfirmDialog({
  visible,
  title,
  description,
  confirmLabel,
  tone = 'danger',
  loading,
  onConfirm,
  onCancel,
  children,
}: Props) {
  return (
    <Dialog
      visible={visible}
      title={title}
      description={description}
      onClose={loading ? () => {} : onCancel}
      actions={
        <>
          <Button label="Voltar" variant="ghost" onPress={onCancel} disabled={loading} />
          <Button label={confirmLabel} variant={tone} loading={loading} onPress={onConfirm} />
        </>
      }
    >
      {children}
    </Dialog>
  );
}
