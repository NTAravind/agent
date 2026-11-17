import '../../global.css';

import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { HeroUINativeProvider } from 'heroui-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider } from '@/lib/session';

// Lets expo-web-browser close the auth popup / custom tab once the OAuth
// redirect lands (required by Expo's authentication guide).
WebBrowser.maybeCompleteAuthSession();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <SafeAreaProvider>
          <SessionProvider>
            <StatusBar style="auto" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="chat" options={{ headerShown: false }} />
              <Stack.Screen name="threads" options={{ headerShown: false }} />
              <Stack.Screen name="notes" options={{ headerShown: false }} />
              <Stack.Screen name="note" options={{ headerShown: false }} />
              <Stack.Screen name="memories" options={{ headerShown: false }} />
              <Stack.Screen name="agents" options={{ headerShown: false }} />
              <Stack.Screen name="run" options={{ headerShown: false }} />
              <Stack.Screen name="canvas" options={{ headerShown: false }} />
              <Stack.Screen name="canvas/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="mcp" options={{ headerShown: false }} />
              <Stack.Screen name="mcp/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="sign-in" options={{ headerShown: true, title: 'Sign in' }} />
              <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
            </Stack>
          </SessionProvider>
        </SafeAreaProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
