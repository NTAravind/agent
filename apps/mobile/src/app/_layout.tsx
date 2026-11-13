import "@/lib/polyfills";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SessionProvider } from "@/lib/session";

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
