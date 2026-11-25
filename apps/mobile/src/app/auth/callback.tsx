import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Spinner } from 'heroui-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { InlineError } from '@/components/design-system';
import { exchangeCode } from '@/lib/auth';
import { colors, space, typography } from '@/theme';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [exchangeError, setExchangeError] = useState<string | null>(null);

  // The screen unmounts itself on success (`router.replace('/')`), so state
  // updates after the exchange must not touch an unmounted component.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (!code) return;
    try {
      await exchangeCode(code);
      if (mounted.current) router.replace('/');
    } catch (err) {
      if (mounted.current) setExchangeError(err instanceof Error ? err.message : String(err));
    }
  }, [code, router]);

  useEffect(() => {
    void run();
  }, [run]);

  // A redirect without a code can never be exchanged — it is reported, but
  // there is nothing to retry.
  const error = exchangeError ?? (code ? null : 'No authorization code in the redirect.');

  const handleRetry = () => {
    setExchangeError(null);
    void run();
  };

  return (
    <View style={styles.container}>
      {error ? (
        <InlineError
          message={error}
          align="center"
          onRetry={code ? handleRetry : undefined}
          style={styles.error}
        />
      ) : (
        <>
          <Spinner size="lg" color="default" />
          <Text style={styles.statusText}>Signing you in…</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: space.xl,
    gap: space.md,
  },
  error: {
    maxWidth: 320,
  },
  statusText: {
    ...typography.bodySecondary,
    textAlign: 'center',
  },
});
