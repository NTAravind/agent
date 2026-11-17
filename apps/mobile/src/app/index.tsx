import { useCallback, useEffect, useState } from 'react';
import { Alert, Avatar, Button, Card, Spinner, Typography } from 'heroui-native';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiFetchDebug, API_BASE_URL, ApiRequestError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, isLoading, signOut } = useSession();
  const [health, setHealth] = useState<string | null>(null);
  const [debug, setDebug] = useState<string | null>(null);
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
    setDebug(null);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        throw new ApiRequestError(401, 'unauthorized', 'No active session.');
      }
      const result = await apiFetchDebug('/api/health', {
        token: sessionData.session.access_token,
      });
      setDebug(
        `${result.url}\nheaders: ${result.headerNames.join(', ')}\ntoken length: ${
          result.tokenLength
        }\nstatus: ${result.status}`,
      );
      if (result.status === 200) {
        setHealth(result.body);
      } else {
        setError(`HTTP ${result.status}: ${result.body}`);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setChecking(false);
    }
  }, []);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner />
      </View>
    );
  }

  const email = session?.user.email ?? session?.user.id ?? '';
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 24,
          gap: 16,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row items-center gap-3">
          <Avatar size="md">
            <Avatar.Fallback>
              <Typography type="body-sm">{initials}</Typography>
            </Avatar.Fallback>
          </Avatar>
          <View className="flex-1">
            <Typography type="h3">Agent</Typography>
            <Typography type="body-sm" color="muted" numberOfLines={1}>
              {email}
            </Typography>
          </View>
        </View>

        <Card className="rounded-2xl">
          <Card.Body className="gap-3">
            <Card.Title>Chat</Card.Title>
            <Card.Description>
              Talk to the model of your choice. Switch models any time from the chat header.
            </Card.Description>
            <View className="gap-2">
              <Button size="lg" onPress={() => router.push('/chat')}>
                <Button.Label>Open chat</Button.Label>
              </Button>
              <Button size="md" variant="secondary" onPress={() => router.push('/threads')}>
                <Button.Label>Threads</Button.Label>
              </Button>
            </View>
          </Card.Body>
        </Card>

        <Card className="rounded-2xl">
          <Card.Body className="gap-3">
            <Card.Title>Agents</Card.Title>
            <Card.Description>
              Give the agent a longer task — it plans, researches and reports back, even after you close the app.
            </Card.Description>
            <Button size="md" variant="secondary" onPress={() => router.push('/agents')}>
              <Button.Label>Open agents</Button.Label>
            </Button>
          </Card.Body>
        </Card>

        <Card className="rounded-2xl">
          <Card.Body className="gap-3">
            <Card.Title>Integrations</Card.Title>
            <Card.Description>
              Connect vendor-hosted MCP tools — web search, docs, payments, monitoring — and let your agent use them in its runs.
            </Card.Description>
            <Button size="md" variant="secondary" onPress={() => router.push('/mcp')}>
              <Button.Label>Browse marketplace</Button.Label>
            </Button>
          </Card.Body>
        </Card>

        <Card className="rounded-2xl">
          <Card.Body className="gap-3">
            <Card.Title>Knowledge</Card.Title>
            <Card.Description>
              Browse the notes synced from your vault, and everything the agent remembers about you.
            </Card.Description>
            <View className="gap-2">
              <Button size="md" variant="secondary" onPress={() => router.push('/notes')}>
                <Button.Label>Notes</Button.Label>
              </Button>
              <Button size="md" variant="secondary" onPress={() => router.push('/memories')}>
                <Button.Label>Memories</Button.Label>
              </Button>
            </View>
          </Card.Body>
        </Card>

        <Card className="rounded-2xl">
          <Card.Body className="gap-3">
            <Card.Title>API status</Card.Title>
            <Card.Description numberOfLines={1}>
              {API_BASE_URL ? API_BASE_URL : 'EXPO_PUBLIC_API_BASE_URL is not set.'}
            </Card.Description>
            <Button size="md" variant="outline" onPress={() => void checkHealth()} isDisabled={checking}>
              {checking ? <Spinner size="sm" /> : <Button.Label>Check /api/health</Button.Label>}
            </Button>

            {health ? (
              <Alert status="success">
                <Alert.Content>
                  <Alert.Title>Connected</Alert.Title>
                  <Alert.Description>{health}</Alert.Description>
                </Alert.Content>
              </Alert>
            ) : null}

            {error ? (
              <Alert status="danger">
                <Alert.Content>
                  <Alert.Title>Request failed</Alert.Title>
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Content>
              </Alert>
            ) : null}

            {debug ? (
              <Typography type="body-xs" color="muted">
                {debug}
              </Typography>
            ) : null}
          </Card.Body>
        </Card>

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

        <Button size="md" variant="ghost" onPress={() => void signOut()}>
          <Button.Label>Sign out</Button.Label>
        </Button>
      </ScrollView>
    </View>
  );
}
