import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { apiFetch, API_BASE_URL, ApiRequestError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export default function HomeScreen() {
  const router = useRouter();
  const { session, isLoading, signOut } = useSession();
  const [health, setHealth] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!isLoading && !session) {
      router.replace('/sign-in');
    }
  }, [isLoading, session, router]);

  const checkHealth = useCallback(async () => {
    setChecking(true);
    setError(null);
    setHealth(null);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        throw new ApiRequestError(401, 'unauthorized', 'No active session.');
      }
      const result = await apiFetch<Record<string, unknown>>('/api/health', {
        token: sessionData.session.access_token,
      });
      setHealth(JSON.stringify(result, null, 2));
    } catch (err) {
      setError(err instanceof ApiRequestError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setChecking(false);
    }
  }, []);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Agent</Text>
      <Text style={styles.subtitle}>Signed in as {session?.user.email ?? session?.user.id}</Text>

      <View style={styles.actions}>
        <Pressable style={styles.primaryButton} onPress={() => router.push("/chat")}>
          <Text style={styles.primaryButtonText}>Open chat</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={() => router.push("/threads")}>
          <Text style={styles.secondaryButtonText}>Threads</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Protected API</Text>
        <Text style={styles.cardBody}>
          {API_BASE_URL ? `Calling ${API_BASE_URL}/api/health` : 'EXPO_PUBLIC_API_BASE_URL is not set.'}
        </Text>
        <Pressable style={styles.button} onPress={checkHealth} disabled={checking}>
          {checking ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Check /api/health</Text>}
        </Pressable>
        {health ? <Text style={styles.code}>{health}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      {!isSupabaseConfigured ? (
        <Text style={styles.error}>
          Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in apps/mobile/.env
        </Text>
      ) : null}

      <Pressable style={styles.secondaryButton} onPress={() => void signOut()}>
        <Text style={styles.secondaryButtonText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 24, gap: 16, flexGrow: 1 },
  title: { fontSize: 28, fontWeight: '600' },
  subtitle: { fontSize: 14, opacity: 0.7 },
  actions: { flexDirection: 'row', gap: 10 },
  primaryButton: { backgroundColor: '#208AEF', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  secondaryButton: { borderWidth: 1, borderColor: '#8884', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center' },
  secondaryButtonText: { fontWeight: '600' },
  card: { borderWidth: 1, borderColor: '#8884', borderRadius: 12, padding: 16, gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardBody: { fontSize: 13, opacity: 0.7 },
  button: { backgroundColor: '#208AEF', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  code: { fontSize: 12, fontFamily: 'Courier' },
  error: { fontSize: 13, color: '#c0392b' },
});
