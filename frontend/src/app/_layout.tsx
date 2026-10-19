import { useEffect, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { appFonts } from '@/theme/fonts';
import { createQueryClient } from '@/api/queryClient';
import { createFirebaseGateway } from '@/auth/firebaseGateway';
import { env, envProblem } from '@/config/env';
import { ConfigErrorScreen } from '@/features/session/StatusScreens';
import { RootNavigator } from '@/navigation/RootNavigator';
import { SessionProvider, type SessionDeps } from '@/session/SessionContext';
import { ToastProvider } from '@/ui';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(appFonts);
  const [queryClient] = useState(() => createQueryClient());
  const [deps] = useState<SessionDeps | null>(() =>
    env ? { gateway: createFirebaseGateway(env), apiBaseUrl: env.apiUrl } : null,
  );
  const ready = fontsLoaded || Boolean(fontError);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        {deps ? (
          <SessionProvider deps={deps}>
            <ToastProvider>
              <RootNavigator />
            </ToastProvider>
          </SessionProvider>
        ) : (
          <ConfigErrorScreen problem={envProblem ?? ''} />
        )}
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
