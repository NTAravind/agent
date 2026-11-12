import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { exchangeCode } from '@/lib/auth';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!code) {
        setError('No authorization code in the redirect.');
        return;
      }
      try {
        await exchangeCode(code);
        if (!cancelled) router.replace('/');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [code, router]);

  return (
    <View style={styles.container}>
      {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator />}
      <Text style={styles.subtitle}>Signing you in…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  subtitle: { opacity: 0.7 },
  error: { color: '#c0392b', textAlign: 'center', paddingHorizontal: 24 },
});
