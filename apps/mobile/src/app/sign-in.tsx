import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { authRedirectUrl, signInWithGitHub } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';

export default function SignInScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGitHub();
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign in</Text>
      <Text style={styles.subtitle}>Use the GitHub account allow-listed on the server.</Text>

      <Pressable
        style={[styles.button, (!isSupabaseConfigured || busy) && styles.buttonDisabled]}
        onPress={() => void handleSignIn()}
        disabled={busy || !isSupabaseConfigured}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Continue with GitHub</Text>
        )}
      </Pressable>

      {!isSupabaseConfigured ? (
        <Text style={styles.error}>
          Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in apps/mobile/.env
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.hintBox}>
        <Text style={styles.hintTitle}>Redirect URL (add this to Supabase → Authentication → URL Configuration → Redirect URLs)</Text>
        <Text selectable style={styles.hintValue}>
          {authRedirectUrl}
        </Text>
        <Text style={styles.hintText}>
          Supabase must allow-list this exact URL, otherwise it redirects to the Site URL and the
          phone shows “address unreachable”.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.7 },
  button: { backgroundColor: '#111', borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600' },
  error: { fontSize: 13, color: '#c0392b' },
  hintBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f2f2f7',
    gap: 6,
  },
  hintTitle: { fontSize: 11, fontWeight: '700', opacity: 0.7 },
  hintValue: { fontSize: 12, fontFamily: 'Courier' },
  hintText: { fontSize: 11, opacity: 0.6 },
});
