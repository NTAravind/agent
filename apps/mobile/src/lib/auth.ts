import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import { supabase } from '@/lib/supabase';

/**
 * The deep link the OAuth provider redirects back to.
 *
 * Native (Expo Go / dev build): `exp://<host>:8081/--/auth/callback`, where
 * <host> is the machine running `expo start` (127.0.0.1 on a simulator, your
 * LAN IP on a real device). Supabase must have the exact string in its
 * redirect allow-list, otherwise it falls back to the Site URL and the phone
 * cannot reach it.
 *
 * Web: the browser cannot open `exp://` URLs, so the current origin is used.
 *
 * Set EXPO_PUBLIC_SUPABASE_REDIRECT_URL to override it (useful when the dev
 * server is behind a tunnel or when the LAN IP changes).
 */
export const authRedirectUrl =
  process.env.EXPO_PUBLIC_SUPABASE_REDIRECT_URL ??
  (Platform.OS === 'web'
    ? `${globalThis.location?.origin ?? ''}/auth/callback`
    : Linking.createURL('/auth/callback'));

export async function signInWithGitHub(): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: authRedirectUrl,
      skipBrowserRedirect: true,
    },
  });

  if (error) throw error;
  if (!data.url) throw new Error('Supabase did not return an OAuth URL.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, authRedirectUrl);

  if (result.type === 'success' && 'url' in result) {
    const code = new URL(result.url).searchParams.get('code');
    if (code) await exchangeCode(code);
    return;
  }

  if (result.type === 'cancel') {
    throw new Error('Sign-in was cancelled.');
  }
}

/** Exchanges the PKCE code from the OAuth redirect for a session. */
export async function exchangeCode(code: string): Promise<void> {
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
}

/**
 * Email + password sign-in.
 *
 * This is the path that works in Expo Go: it needs no redirect at all, so it
 * is not affected by Expo Go's inability to handle custom OAuth schemes
 * (https://docs.expo.dev/guides/authentication/). GitHub OAuth stays enabled
 * for development builds, where `agentapp://auth/callback` works.
 */
export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/** Creates an account with an email + password (email confirmation is off on
 *  a fresh Supabase project unless you turn it on). */
export async function signUpWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
}
