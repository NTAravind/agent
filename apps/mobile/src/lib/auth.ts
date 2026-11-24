import * as Linking from "expo-linking";
import { Platform } from "react-native";

import { supabase } from '@/lib/supabase';

/**
 * The deep link used for email-confirmation redirects.
 *
 * Native (Expo Go / dev build): `exp://<host>:8081/--/auth/callback`, where
 * <host> is the machine running `expo start` (127.0.0.1 on a simulator, your
 * LAN IP on a real device). In a production native build the same route uses
 * the configured app scheme: `pacbot://auth/callback`. Supabase must have the
 * exact string in its redirect allow-list, otherwise it falls back to the Site
 * URL and the phone cannot reach it.
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

/** Exchanges the PKCE code from an email confirmation redirect for a session. */
export async function exchangeCode(code: string): Promise<void> {
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
}

/**
 * Email + password sign-in.
 */
export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/** Creates an account with an email + password (email confirmation is off on
 *  a fresh Supabase project unless you turn it on). */
export async function signUpWithEmail(email: string, password: string): Promise<boolean> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: authRedirectUrl },
  });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("only one account is supported")) {
      throw new Error("This app already has an account. Sign in with that account.");
    }
    if (message.includes("database error saving new user")) {
      throw new Error("This app supports one account. If it already exists, sign in with it.");
    }
    throw error;
  }
  return !data.session;
}
