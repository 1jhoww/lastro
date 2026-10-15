import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wordmark } from '@/brand';
import { color, space } from '@/theme';
import { Button, Text } from '@/ui';
import { CloudOff, type LucideIcon } from '@/ui/icons';

/**
 * Tela de abertura enquanto a sessão é resolvida. Mesmo fundo do splash nativo, para a troca
 * não piscar; nenhum conteúdo privado é montado por trás dela.
 */
export function BootScreen() {
  return (
    <View
      style={styles.boot}
      accessibilityLabel="Carregando o Lastro"
      accessibilityLiveRegion="polite"
    >
      <Wordmark size={40} tone="onDark" />
      <ActivityIndicator color={color.accent} style={styles.spinner} />
    </View>
  );
}

type MessageProps = {
  icon: LucideIcon;
  title: string;
  body: string;
  children?: ReactNode;
};

/** Tela cheia de mensagem (erro de carregamento, configuração, acesso). */
export function MessageScreen({ icon: Icon, title, body, children }: MessageProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.message, { paddingTop: insets.top + space[10] }]}>
      <View style={styles.card}>
        <View style={styles.mark}>
          <Icon size={24} color={color.text} strokeWidth={1.75} />
        </View>
        <Text variant="h2" accessibilityRole="header">
          {title}
        </Text>
        <Text variant="body" color={color.textSecondary}>
          {body}
        </Text>
        {children ? <View style={styles.actions}>{children}</View> : null}
      </View>
    </View>
  );
}

export function MeErrorScreen({
  onRetry,
  onSignOut,
}: {
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <MessageScreen
      icon={CloudOff}
      title="Não foi possível carregar sua conta"
      body="O servidor do Lastro não respondeu. Verifique a conexão e tente de novo."
    >
      <Button label="Tentar de novo" variant="strong" onPress={onRetry} />
      <Button label="Sair" variant="ghost" onPress={onSignOut} />
    </MessageScreen>
  );
}

export function ConfigErrorScreen({ problem }: { problem: string }) {
  return (
    <MessageScreen
      icon={CloudOff}
      title="Configuração incompleta"
      body={`O app não sabe a qual servidor se conectar. ${problem}`}
    />
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: color.structure,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: { marginTop: space[8] },
  message: {
    flex: 1,
    backgroundColor: color.canvas,
    paddingHorizontal: space[5],
    alignItems: 'center',
  },
  card: { width: '100%', maxWidth: 440, gap: space[3] },
  mark: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: color.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[2],
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[3] },
});
