import { Fragment, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { ApiError } from '@/api/errors';
import { useCooldown } from '@/lib/useCooldown';
import { useSession, useTenantApi } from '@/session/SessionContext';
import { color, layout, radius, space, useLayoutSize } from '@/theme';
import { Button, Dialog, IconButton, Panel, Text } from '@/ui';
import { Touchable } from '@/ui/Touchable';
import { focusRing, showFocusRing, type InteractionState } from '@/ui/interaction';
import {
  Download as DownloadIcon,
  EllipsisVertical,
  Eye,
  FileText,
  Share2,
  type LucideIcon,
} from '@/ui/icons';
import { orderDocument } from './api';
import { downloadMessage, type FilePresentation } from './contracts';
import { fileLease } from './fileEpoch';
import { reserveViewer, stageFile } from './presentation';

type Kind = 'commercial' | 'packing';
type Intent = 'open' | 'save' | 'share';

const documents: { kind: Kind; title: string; description: string; prefix: string }[] = [
  {
    kind: 'commercial',
    title: 'Pedido comercial',
    description: 'PDF com valores',
    prefix: 'pedido',
  },
  { kind: 'packing', title: 'Romaneio', description: 'PDF sem valores', prefix: 'romaneio' },
];

const intentLabel: Record<Intent, string> = {
  open: 'Visualizar',
  save: 'Baixar',
  share: 'Compartilhar',
};

/**
 * Documentos oficiais do pedido, gerados pelo servidor. Cada ação obtém o PDF quando preciso e
 * já executa a intenção escolhida. O arquivo fica só nesta tela e é descartado quando o pedido
 * muda de versão, a pessoa sai ou troca de empresa.
 */
export function OrderDocuments({
  id,
  number,
  version,
}: {
  id: string;
  /** Número comercial curto, usado no nome do arquivo (ex.: PED-1A2B3C4D). */
  number: string;
  version: number;
}) {
  const session = useSession();
  if (session.isPlatformAdmin || !session.permissions.includes('documents:own:read')) return null;
  return (
    <Fragment key={`${session.user?.uid}:${session.tenantId}:${id}:${version}`}>
      <Panel title="Documentos">
        <View accessibilityRole="list">
          {documents.map((d, i) => (
            <DocumentRow
              key={d.kind}
              id={id}
              number={number}
              doc={d}
              last={i === documents.length - 1}
            />
          ))}
        </View>
        <Text variant="caption" color={color.textSecondary} style={styles.note}>
          Sem valor fiscal. O romaneio não comprova entrega. Para WhatsApp, compartilhe e escolha o
          contato.
        </Text>
      </Panel>
    </Fragment>
  );
}

function DocumentRow({
  id,
  number,
  doc,
  last,
}: {
  id: string;
  number: string;
  doc: (typeof documents)[number];
  last: boolean;
}) {
  const { api, tenantId } = useTenantApi();
  const compact = useLayoutSize() === 'compact';
  const cooldown = useCooldown();
  const [busy, setBusy] = useState<Intent | null>(null);
  const [error, setError] = useState<{ message: string; intent: Intent } | null>(null);
  const [menu, setMenu] = useState(false);
  const file = useRef<FilePresentation | null>(null);
  const task = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      task.current?.abort();
      file.current?.dispose();
      file.current = null;
    },
    [],
  );

  const run = async (intent: Intent) => {
    if (busy || cooldown.seconds) return;
    setError(null);
    // Web: a aba precisa nascer no toque; o PDF chega depois.
    const viewer =
      intent === 'open' && Platform.OS === 'web' && !file.current ? reserveViewer() : null;
    try {
      if (!file.current) {
        setBusy(intent);
        const abort = new AbortController();
        task.current = abort;
        const check = fileLease();
        const downloaded = await orderDocument(api, tenantId, id, doc.kind, abort.signal);
        check();
        if (task.current !== abort) return;
        file.current = stageFile({ ...downloaded, filename: `${doc.prefix}-${number}.pdf` });
      }
      const presentation = file.current;
      if (intent === 'open') await presentation.open(viewer);
      else if (intent === 'save') await presentation.save();
      else await presentation.share();
    } catch (e) {
      viewer?.close();
      const name = e instanceof Error ? e.name : '';
      // Compartilhamento cancelado pela pessoa: nada a avisar.
      if (name === 'AbortError') return;
      if (e instanceof ApiError) cooldown.wait(e.retryAfterSeconds);
      setError({
        intent,
        message:
          name === 'NotAllowedError'
            ? 'Arquivo pronto. Toque de novo para compartilhar.'
            : downloadMessage(e),
      });
    } finally {
      setBusy(null);
    }
  };

  const disabled = busy !== null || cooldown.seconds > 0;

  return (
    <View style={[styles.row, !last && styles.divider]}>
      <View style={styles.main}>
        <View style={styles.icon}>
          <FileText size={18} color={color.textSecondary} strokeWidth={1.75} />
        </View>
        <View style={styles.flex}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {doc.title}
          </Text>
          <Text variant="caption" color={color.textSecondary}>
            {busy ? 'Gerando PDF…' : doc.description}
          </Text>
        </View>
        {compact ? (
          <View style={styles.actions}>
            <Button
              label="Abrir"
              accessibilityLabel={`Abrir ${doc.title}`}
              size="sm"
              variant="outline"
              loading={busy === 'open'}
              disabled={disabled}
              onPress={() => run('open')}
            />
            {busy && busy !== 'open' ? (
              <View style={styles.spinner}>
                <ActivityIndicator size="small" color={color.text} />
              </View>
            ) : (
              <IconButton
                icon={EllipsisVertical}
                label={`Mais ações de ${doc.title}`}
                disabled={disabled}
                onPress={() => setMenu(true)}
              />
            )}
          </View>
        ) : (
          <View style={styles.actions}>
            {(['open', 'save', 'share'] as const).map((intent) => (
              <IconAction
                key={intent}
                icon={intent === 'open' ? Eye : intent === 'save' ? DownloadIcon : Share2}
                label={intentLabel[intent]}
                accessibilityLabel={`${intentLabel[intent]} ${doc.title}`}
                loading={busy === intent}
                disabled={disabled}
                onPress={() => run(intent)}
              />
            ))}
          </View>
        )}
      </View>

      {cooldown.seconds ? (
        <Text variant="caption" color={color.textSecondary}>
          {`Aguarde ${cooldown.seconds} s para tentar de novo.`}
        </Text>
      ) : null}
      {error ? (
        <View style={styles.error} accessibilityLiveRegion="polite">
          <Text variant="small" color={color.danger} style={styles.flex}>
            {error.message}
          </Text>
          <Button
            label="Tentar novamente"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onPress={() => run(error.intent)}
          />
        </View>
      ) : null}

      <Dialog visible={menu} title={doc.title} onClose={() => setMenu(false)}>
        {(['save', 'share'] as const).map((intent) => (
          <Touchable
            key={intent}
            accessibilityRole="button"
            accessibilityLabel={`${intentLabel[intent]} ${doc.title}`}
            onPress={() => {
              setMenu(false);
              run(intent);
            }}
            pressStyle={(s: InteractionState) => [
              styles.menuItem,
              (s.hovered || s.pressed) && styles.hover,
              showFocusRing(s) && focusRing(),
            ]}
          >
            {intent === 'save' ? (
              <DownloadIcon size={20} color={color.text} strokeWidth={1.75} />
            ) : (
              <Share2 size={20} color={color.text} strokeWidth={1.75} />
            )}
            <Text variant="body">{intentLabel[intent]}</Text>
          </Touchable>
        ))}
      </Dialog>
    </View>
  );
}

/** Botão pequeno só com ícone e dica no passar do mouse ou no foco por teclado. */
function IconAction({
  icon: Icon,
  label,
  accessibilityLabel,
  loading,
  disabled,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  accessibilityLabel: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const [hint, setHint] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled, busy: loading }}
        disabled={disabled}
        onPress={onPress}
        onHoverIn={() => setHint(true)}
        onHoverOut={() => setHint(false)}
        onFocus={() => setHint(true)}
        onBlur={() => setHint(false)}
        style={(s: InteractionState) => [
          styles.iconAction,
          (s.hovered || s.pressed) && !disabled && styles.hover,
          disabled && !loading && styles.dimmed,
          showFocusRing(s) && focusRing(),
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={color.text} />
        ) : (
          <Icon size={18} color={color.text} strokeWidth={1.75} />
        )}
      </Pressable>
      {hint && !loading ? (
        <View pointerEvents="none" style={[styles.tooltip, tooltipWidth]}>
          <Text variant="caption" color={color.onStructure}>
            {label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// Dica posicionada fora do botão: largura pelo conteúdo, não pelos 36 px do botão.
const tooltipWidth = (Platform.OS === 'web' ? { width: 'max-content' } : {}) as ViewStyle;

const styles = StyleSheet.create({
  row: { gap: space[2], paddingVertical: space[3] },
  divider: { borderBottomWidth: 1, borderBottomColor: color.border },
  main: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surfaceSunken,
  },
  flex: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  spinner: {
    width: layout.hitTarget,
    height: layout.hitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconAction: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hover: { backgroundColor: 'rgba(17,17,17,0.05)' },
  dimmed: { opacity: 0.4 },
  tooltip: {
    position: 'absolute',
    bottom: '100%',
    right: 0,
    marginBottom: space[1],
    paddingHorizontal: space[2],
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: color.structure,
    zIndex: 30,
  },
  error: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingLeft: 36 + space[3] },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.hitTarget + 8,
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
  },
  note: { paddingTop: space[2] },
});
