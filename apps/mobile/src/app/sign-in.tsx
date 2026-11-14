import { useState } from 'react';
import { Alert, Button, Input, Spinner, Typography } from 'heroui-native';
import { View } from 'react-native';
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
    <View className="flex-1 justify-center gap-3 bg-background px-5 py-8">
      <Typography type="h2">Sign in</Typography>

      <Input
        placeholder="you@example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        isDisabled={busy}
      />

      <Input
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        isDisabled={busy}
      />

      <Button
        onPress={() => void handleEmailAuth()}
        isDisabled={busy || !isSupabaseConfigured}
      >
        {busy ? (
          <Spinner size="sm" color="default" />
        ) : (
          <Button.Label>
            {mode === 'sign-up' ? 'Create account' : 'Sign in with email'}
          </Button.Label>
        )}
      </Button>

      <Button variant="ghost" onPress={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
        <Button.Label>
          {mode === 'sign-in' ? 'Need an account? Create one' : 'Have an account? Sign in'}
        </Button.Label>
      </Button>

      <View className="my-2 flex-row items-center gap-3">
        <View className="h-px flex-1 bg-separator" />
        <Typography type="body-xs" color="muted">
          or
        </Typography>
        <View className="h-px flex-1 bg-separator" />
      </View>

      <Button
        variant="secondary"
        onPress={() => void run(signInWithGitHub)}
        isDisabled={busy || !isSupabaseConfigured}
      >
        <Button.Label>Continue with GitHub</Button.Label>
      </Button>

      {!isSupabaseConfigured ? (
        <Alert status="warning">
          <Alert.Content>
            <Alert.Title>Not configured</Alert.Title>
            <Alert.Description>
              Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in
              apps/mobile/.env
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {error ? (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>Sign-in failed</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {notice ? (
        <Alert status="success">
          <Alert.Content>
            <Alert.Title>Almost there</Alert.Title>
            <Alert.Description>{notice}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <View className="mt-2 gap-1 rounded-xl bg-surface-secondary p-3">
        <Typography type="body-xs" className="font-semibold">
          GitHub OAuth needs a development build
        </Typography>
        <Typography type="body-xs" color="muted">
          Expo Go cannot handle custom OAuth redirect schemes, so use email + password here. With a
          development build (npx expo run:android), GitHub OAuth works with the redirect URL:
        </Typography>
        <Typography type="code">{authRedirectUrl}</Typography>
      </View>
    </View>
  );
}
