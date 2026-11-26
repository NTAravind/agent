import '../../global.css';

import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Notifications from 'expo-notifications';
import { HeroUINativeProvider } from 'heroui-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider, useSession } from '@/lib/session';
import { registerForPushNotifications, initNotifications } from '@/lib/push';
import { ErrorDialogProvider } from '@/components/error-dialog-provider';

// Lets expo-web-browser close the auth popup / custom tab once the OAuth
// redirect lands (required by Expo's authentication guide).
WebBrowser.maybeCompleteAuthSession();

/**
 * Registers the device for push notifications (Phase 9) once the user is
 * signed in, and deep-links into the app when a reminder is tapped.
 */
function usePushNotifications(isSignedIn: boolean) {
  useEffect(() => {
    initNotifications();
    if (!isSignedIn) return;
    void registerForPushNotifications();
  }, [isSignedIn]);

  useEffect(() => {
    function redirect(notification: Notifications.Notification) {
      const url = notification.request.content.data?.url;
      if (typeof url === 'string') {
        router.push(url as never);
        Notifications.clearLastNotificationResponse();
      }
    }

    const last = Notifications.getLastNotificationResponse();
    if (last?.notification) redirect(last.notification);

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      redirect(response.notification);
    });

    return () => {
      subscription.remove();
    };
  }, []);
}

function Shell() {
  const { session, isLoading } = useSession();
  usePushNotifications(Boolean(session) && !isLoading);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="threads" options={{ headerShown: false }} />
      <Stack.Screen name="note" options={{ headerShown: false }} />
      <Stack.Screen name="tasks" options={{ headerShown: false }} />
      <Stack.Screen name="calendar" options={{ headerShown: false }} />
      <Stack.Screen name="memories" options={{ headerShown: false }} />
      <Stack.Screen name="skills" options={{ headerShown: false }} />
      <Stack.Screen name="skills/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="routines" options={{ headerShown: false }} />
      <Stack.Screen name="groups/index" options={{ headerShown: false }} />
      <Stack.Screen name="groups/new" options={{ headerShown: false }} />
      <Stack.Screen name="groups/[id]/index" options={{ headerShown: false }} />
      <Stack.Screen name="groups/[id]/edit" options={{ headerShown: false }} />
      <Stack.Screen name="agents/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="agents/[id]/edit" options={{ headerShown: false }} />
      <Stack.Screen name="run" options={{ headerShown: false }} />
      <Stack.Screen name="canvas" options={{ headerShown: false }} />
      <Stack.Screen name="canvas/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="mcp" options={{ headerShown: false }} />
      <Stack.Screen name="mcp/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <SafeAreaProvider>
          <ErrorDialogProvider>
            <SessionProvider>
              <StatusBar style="auto" />
              <Shell />
            </SessionProvider>
          </ErrorDialogProvider>
        </SafeAreaProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
