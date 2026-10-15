import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, elevation, layout, radius, space, useLayoutSize } from '@/theme';
import { CircleAlert, CircleCheck } from './icons';
import { Text } from './Text';

type Toast = { id: number; message: string; tone: 'success' | 'danger' };
type ToastApi = { show: (message: string, tone?: Toast['tone']) => void };

const ToastContext = createContext<ToastApi>({ show: () => {} });
export const useToast = () => useContext(ToastContext);

/**
 * Confirmação breve depois de uma ação ("Cliente salvo"). Lida por leitores de tela e some
 * sozinha; erros que exigem decisão ficam em Alert na própria tela, não aqui.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const seq = useRef(0);
  const show = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    seq.current += 1;
    setToast({ id: seq.current, message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast ? <ToastView key={toast.id} toast={toast} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ toast }: { toast: Toast }) {
  const insets = useSafeAreaInsets();
  const compact = useLayoutSize() === 'compact';
  const Icon = toast.tone === 'success' ? CircleCheck : CircleAlert;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.wrap,
        { bottom: compact ? layout.tabBarHeight + insets.bottom + space[3] : space[6] },
      ]}
    >
      <View
        accessibilityRole={toast.tone === 'danger' ? 'alert' : undefined}
        accessibilityLiveRegion="polite"
        style={styles.toast}
      >
        <Icon
          size={18}
          color={toast.tone === 'success' ? color.accent : '#F59A92'}
          strokeWidth={2}
        />
        <Text variant="bodyStrong" color={color.onStructure} style={styles.text}>
          {toast.message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space[4], right: space[4], alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    maxWidth: 480,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: color.structure,
    ...elevation.overlay,
  },
  text: { flexShrink: 1 },
});
