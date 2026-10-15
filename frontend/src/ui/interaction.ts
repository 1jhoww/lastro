import { Platform, type PressableStateCallbackType } from 'react-native';

/** React Native Web acrescenta hovered/focused ao estado do Pressable. */
export type InteractionState = PressableStateCallbackType & {
  hovered?: boolean;
  focused?: boolean;
};

let keyboardModality = false;

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.addEventListener(
    'keydown',
    (e) => {
      if (!e.metaKey && !e.altKey && !e.ctrlKey) keyboardModality = true;
    },
    true,
  );
  document.addEventListener(
    'pointerdown',
    () => {
      keyboardModality = false;
    },
    true,
  );
}

/**
 * Equivalente a :focus-visible: o anel de foco aparece na navegação por teclado,
 * não a cada clique.
 */
export function showFocusRing(state: InteractionState): boolean {
  return Boolean(state.focused) && (Platform.OS !== 'web' || keyboardModality);
}

/** Anel de foco desenhado fora da borda, sem deslocar o layout. */
export function focusRing(onStructure = false) {
  return {
    boxShadow: onStructure
      ? '0 0 0 2px #111111, 0 0 0 4px #F3B800'
      : '0 0 0 2px #F6F3ED, 0 0 0 4px #111111',
  } as const;
}
