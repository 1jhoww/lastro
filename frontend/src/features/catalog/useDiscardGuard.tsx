import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { ConfirmDialog } from '@/ui';

/**
 * Evita perder um formulário de cadastro por engano. Com alterações não salvas, "Cancelar"
 * pede confirmação e, na web, fechar ou recarregar a aba avisa o navegador.
 */
export function useDiscardGuard(dirty: boolean, onLeave: () => void) {
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty || typeof window === 'undefined') return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const cancel = () => (dirty ? setAsking(true) : onLeave());
  const dialog = (
    <ConfirmDialog
      visible={asking}
      title="Descartar alterações?"
      description="O que você mudou neste formulário ainda não foi salvo e será perdido."
      confirmLabel="Descartar alterações"
      onCancel={() => setAsking(false)}
      onConfirm={() => {
        setAsking(false);
        onLeave();
      }}
    />
  );
  return { cancel, dialog };
}
