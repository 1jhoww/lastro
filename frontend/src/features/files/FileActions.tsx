import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { Alert, Button, Text } from '@/ui';
import { space } from '@/theme';
import { downloadMessage, type Download, type FilePresentation } from './contracts';
import { stageFile } from './presentation';
import { fileLease } from './fileEpoch';
import { ApiError } from '@/api/errors';
import { useCooldown } from '@/lib/useCooldown';

/** Mantém bytes só nesta tela. Uma solicitação atrasada nunca abre arquivo automaticamente. */
export function FileActions({
  load,
  label,
  onLoaded,
}: {
  load: (signal: AbortSignal) => Promise<Download>;
  label: string;
  onLoaded?: (file: Download) => void;
}) {
  const [busy, setBusy] = useState(false);
  const cooldown = useCooldown();
  const [file, setFile] = useState<{ presentation: FilePresentation; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const task = useRef<{ abort: AbortController; dispose?: () => void } | null>(null);
  useEffect(
    () => () => {
      task.current?.abort.abort();
      task.current?.dispose?.();
      task.current = null;
    },
    [],
  );
  const request = async () => {
    if (busy || cooldown.seconds) return;
    task.current?.abort.abort();
    task.current?.dispose?.();
    const current = {
      abort: new AbortController(),
      dispose: undefined as (() => void) | undefined,
    };
    task.current = current;
    const check = fileLease();
    setFile(null);
    setError(null);
    setBusy(true);
    try {
      const downloaded = await load(current.abort.signal);
      check();
      if (task.current !== current) return;
      const presentation = stageFile(downloaded);
      current.dispose = presentation.dispose;
      setFile({ presentation, name: downloaded.filename });
      onLoaded?.(downloaded);
    } catch (e) {
      if (task.current === current && e instanceof ApiError) cooldown.wait(e.retryAfterSeconds);
      if (task.current === current) setError(downloadMessage(e));
    } finally {
      if (task.current === current) setBusy(false);
    }
  };
  const act = async (action: () => Promise<void>) => {
    try {
      setError(null);
      await action();
    } catch (e) {
      setError(downloadMessage(e));
    }
  };
  return (
    <View style={{ gap: space[3] }}>
      <Button
        label={label}
        loading={busy}
        disabled={cooldown.seconds > 0}
        variant="outline"
        onPress={request}
      />
      {cooldown.seconds ? (
        <Text variant="small">{`Aguarde ${cooldown.seconds} segundos antes de solicitar outro arquivo.`}</Text>
      ) : null}
      {file ? (
        <>
          <Text variant="small" selectable>
            {file.name}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            <Button
              label={Platform.OS === 'web' ? 'Abrir arquivo' : 'Abrir opções do arquivo'}
              size="sm"
              variant="outline"
              onPress={() => act(file.presentation.open)}
            />
            <Button
              label={Platform.OS === 'web' ? 'Baixar arquivo' : 'Salvar ou compartilhar'}
              size="sm"
              variant="outline"
              onPress={() => act(file.presentation.save)}
            />
            {Platform.OS === 'web' ? (
              <Button
                label="Compartilhar arquivo"
                size="sm"
                variant="outline"
                onPress={() => act(file.presentation.share)}
              />
            ) : null}
          </View>
        </>
      ) : null}
      {error ? (
        <Alert tone="danger" title="Arquivo indisponível">
          {error}
        </Alert>
      ) : null}
    </View>
  );
}
