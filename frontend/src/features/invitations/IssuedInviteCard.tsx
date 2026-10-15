import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { color, radius, space } from '@/theme';
import { Alert, Button, Text } from '@/ui';
import { Copy } from '@/ui/icons';
import { invitationLink } from './inviteLink';

/**
 * Link de convite recém-emitido. O backend devolve o token uma única vez e não envia e-mail
 * nesta fase: quem convidou precisa repassar o link por um canal seguro.
 */
export function IssuedInviteCard({
  email,
  token,
  onDone,
}: {
  email: string;
  token: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const link = invitationLink(token);
  return (
    <Alert
      tone="success"
      title={`Convite criado para ${email}`}
      action={
        <View style={styles.actions}>
          <Button
            label={copied ? 'Link copiado' : 'Copiar link'}
            size="sm"
            variant="strong"
            icon={Copy}
            onPress={async () => {
              await Clipboard.setStringAsync(link);
              setCopied(true);
            }}
          />
          <Button label="Concluir" size="sm" variant="ghost" onPress={onDone} />
        </View>
      }
    >
      <View style={styles.body}>
        <Text variant="small">
          Envie este link para a pessoa por um canal seguro. Ele aparece só agora e vale por sete
          dias.
        </Text>
        <Text variant="small" selectable style={styles.link}>
          {link}
        </Text>
      </View>
    </Alert>
  );
}

const styles = StyleSheet.create({
  body: { gap: space[2] },
  link: {
    backgroundColor: color.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
    padding: space[2],
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
});
