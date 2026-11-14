import "@/lib/polyfills";

import { Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionProvider } from "@/lib/session";

// Lets expo-web-browser close the auth popup / custom tab once the OAuth
// redirect lands (required by Expo's authentication guide).
WebBrowser.maybeCompleteAuthSession();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="chat" options={{ headerShown: false }} />
          <Stack.Screen name="threads" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ headerShown: true, title: "Sign in" }} />
          <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
