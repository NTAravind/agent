import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { authRedirectUrl, signInWithEmail, signInWithGitHub, signUpWithEmail } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';

type Mode = 'sign-in' | 'sign-up';

export default function SignInScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleEmailAuth = () =>
    run(async () => {
      if (!email.trim() || !password) {
        throw new Error('Enter an email address and a password.');
      }
      if (mode === 'sign-up') {
        await signUpWithEmail(email.trim(), password);
        setNotice('Account created — you can sign in now.');
        setMode('sign-in');
        return;
      }
      await signInWithEmail(email.trim(), password);
    });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign in</Text>

      <TextInput
        style={styles.input}
        placeholder="you@example.com"
        placeholderTextColor="#888"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        editable={!busy}
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor="#888"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        editable={!busy}
      />

      <Pressable
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={() => void handleEmailAuth()}
        disabled={busy || !isSupabaseConfigured}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {mode === 'sign-up' ? 'Create account' : 'Sign in with email'}
          </Text>
        )}
      </Pressable>

      <Pressable
        onPress={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
        disabled={busy}
      >
        <Text style={styles.link}>
          {mode === 'sign-in' ? 'Need an account? Create one' : 'Have an account? Sign in'}
        </Text>
      </Pressable>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      <Pressable
        style={[styles.secondaryButton, busy && styles.buttonDisabled]}
        onPress={() => void run(signInWithGitHub)}
        disabled={busy || !isSupabaseConfigured}
      >
        <Text style={styles.secondaryButtonText}>Continue with GitHub</Text>
      </Pressable>

      {!isSupabaseConfigured ? (
        <Text style={styles.error}>
          Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in apps/mobile/.env
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <View style={styles.hintBox}>
        <Text style={styles.hintTitle}>
          GitHub OAuth needs a development build in Expo Go
        </Text>
        <Text style={styles.hintText}>
          Expo Go cannot handle custom OAuth redirect schemes, so use email + password here. With a
          development build (`npx expo run:android`), GitHub OAuth works with the redirect URL:
        </Text>
        <Text selectable style={styles.hintValue}>
          {authRedirectUrl}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  button: { backgroundColor: '#111', borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#111',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: { fontWeight: '600' },
  link: { fontSize: 14, color: '#208AEF', textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e5e5ea' },
  dividerText: { fontSize: 12, opacity: 0.5 },
  error: { fontSize: 13, color: '#c0392b' },
  notice: { fontSize: 13, color: '#15803d' },
  hintBox: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f2f2f7',
    gap: 6,
  },
  hintTitle: { fontSize: 11, fontWeight: '700', opacity: 0.7 },
  hintValue: { fontSize: 12, fontFamily: 'Courier' },
  hintText: { fontSize: 11, opacity: 0.6 },
});
