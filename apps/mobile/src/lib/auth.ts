import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';

/** Deep link the OAuth provider redirects back to (agentapp://auth/callback). */
export const authRedirectUrl = Linking.createURL('/auth/callback');

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

  await WebBrowser.openAuthSessionAsync(data.url, authRedirectUrl);
}

/** Exchanges the PKCE code from the OAuth redirect for a session. */
export async function exchangeCode(code: string): Promise<void> {
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
}
