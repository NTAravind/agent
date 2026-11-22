import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Spinner } from 'heroui-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { exchangeCode } from '@/lib/auth';
import { colors, radius, space, typography } from '@/theme';

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
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : (
        <Spinner size="lg" color="default" />
      )}
      <Text style={styles.statusText}>
        Signing you in…
      </Text>
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
  errorBox: {
    borderRadius: radius.card,
    backgroundColor: colors.recordingBg,
    padding: space.lg,
    maxWidth: 320,
  },
  errorText: {
    ...typography.bodySecondary,
    color: colors.recording,
    textAlign: 'center',
  },
  statusText: {
    ...typography.bodySecondary,
    textAlign: 'center',
  },
});
