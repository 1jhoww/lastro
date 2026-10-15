import { Slot } from 'expo-router';
import { PlatformShell } from '@/features/platform/PlatformShell';

// Acesso garantido pelo RootNavigator (só /me.platformAdmin). O backend revalida cada chamada.
export default function PlatformLayout() {
  return (
    <PlatformShell>
      <Slot />
    </PlatformShell>
  );
}
