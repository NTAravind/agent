import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Spinner } from 'heroui-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Activity,
  BookMarked,
  CalendarDays,
  ChevronRight,
  Database,
  Layers,
  LayoutDashboard,
  ListTodo,
  LogOut,
  MessageSquare,
  Sparkles,
  Sun,
} from 'lucide-react-native';

import { apiFetchDebug, ApiRequestError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, isLoading, signOut } = useSession();
  const [health, setHealth] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const result = await apiFetchDebug('/api/health', {
        token: sessionData.session.access_token,
      });
      if (result.status === 200) {
        setHealth('All systems operational');
      } else {
        setError(`HTTP ${result.status}`);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setChecking(false);
    }
  }, []);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-[#09090b]">
        <Spinner size="lg" color="default" />
      </View>
    );
  }

  const email = session?.user.email ?? session?.user.id ?? '';
  const initial = email.slice(0, 1).toUpperCase() || '👤';

  const NAV_GROUPS: {
    title: string;
    items: {
      title: string;
      subtitle: string;
      icon: typeof MessageSquare;
      color: string;
      route: string;
    }[];
  }[] = [
    {
      title: 'Productivity',
      items: [
        {
          title: 'Today',
          subtitle: 'Agenda, due tasks and quick capture',
          icon: Sun,
          color: '#F59E0B',
          route: '/',
        },
        {
          title: 'Tasks',
          subtitle: 'Lists, subtasks, due dates & priorities',
          icon: ListTodo,
          color: '#10B981',
          route: '/tasks',
        },
        {
          title: 'Calendar',
          subtitle: 'Month, week and agenda — with recurrence',
          icon: CalendarDays,
          color: '#3B82F6',
          route: '/calendar',
        },
      ],
    },
    {
      title: 'Workspace',
      items: [
        {
          title: 'Canvas',
          subtitle: 'Saved dashboards, metrics & interactive reports',
          icon: LayoutDashboard,
          color: '#F59E0B',
          route: '/canvas',
        },
        {
          title: 'Integrations (MCP)',
          subtitle: 'Connect web search, databases, APIs & tool servers',
          icon: Layers,
          color: '#10B981',
          route: '/mcp',
        },
        {
          title: 'Skills',
          subtitle: 'Reusable instruction bundles agents load on demand',
          icon: BookMarked,
          color: '#06B6D4',
          route: '/skills',
        },
        {
          title: 'Agent Memory',
          subtitle: 'Durable facts, preferences and decisions',
          icon: Database,
          color: '#EC4899',
          route: '/memories',
        },
      ],
    },
  ];

  return (
    <View className="flex-1 bg-white dark:bg-[#09090b]">
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 32,
          gap: 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* User Profile Header */}
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <View className="h-11 w-11 items-center justify-center rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-100 dark:bg-white/10">
              <Text className="text-base font-bold text-zinc-900 dark:text-white">
                {initial}
              </Text>
            </View>
            <View>
              <Text className="text-lg font-bold text-zinc-900 dark:text-white">
                More
              </Text>
              <Text numberOfLines={1} className="text-xs text-zinc-500 max-w-[200px]">
                {email}
              </Text>
            </View>
          </View>

          <Pressable
            onPress={() => void signOut()}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            className="h-9 w-9 items-center justify-center rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 active:bg-zinc-100 dark:active:bg-white/10"
          >
            <LogOut size={16} color="#71717a" />
          </Pressable>
        </View>

        {/* Hero Quick Chat Card */}
        <Pressable
          onPress={() => router.push('/chat')}
          className="rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-900 dark:bg-[#121215] p-5 shadow-lg active:opacity-90"
        >
          <View className="flex-row items-center justify-between mb-3">
            <View className="flex-row items-center gap-2">
              <Sparkles size={18} color="#ffffff" />
              <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Start Chatting
              </Text>
            </View>
            <View className="h-2 w-2 rounded-full bg-emerald-400" />
          </View>
          <Text className="text-xl font-bold text-white mb-1">
            What do you want to explore?
          </Text>
          <Text className="text-xs text-zinc-400 mb-4 leading-4">
            Chat with Gemini, Groq, Mistral, DeepSeek or launch autonomous background agents.
          </Text>
          <View className="flex-row items-center gap-2">
            <View className="rounded-full bg-white px-4 py-2 self-start shadow-sm">
              <Text className="text-xs font-bold text-black">Open Chat →</Text>
            </View>
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                router.push('/threads');
              }}
              className="rounded-full border border-white/20 bg-white/10 px-4 py-2"
            >
              <Text className="text-xs font-medium text-white">History</Text>
            </Pressable>
          </View>
        </Pressable>

        {/* Command Navigation Grid */}
        <View className="gap-4">
          {NAV_GROUPS.map((group) => (
            <View key={group.title} className="gap-2.5">
              <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 px-1">
                {group.title}
              </Text>

              {group.items.map((item) => {
                const IconComponent = item.icon;
                return (
                  <Pressable
                    key={item.title}
                    onPress={() => router.push(item.route as never)}
                    className="flex-row items-center rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-4 active:bg-zinc-100 dark:active:bg-[#18181e] shadow-sm"
                  >
                    <View
                      className="h-10 w-10 items-center justify-center rounded-2xl mr-3.5"
                      style={{ backgroundColor: `${item.color}20` }}
                    >
                      <IconComponent size={20} color={item.color} />
                    </View>

                    <View className="flex-1 min-w-0 pr-2">
                      <Text className="text-base font-semibold text-zinc-900 dark:text-white">
                        {item.title}
                      </Text>
                      <Text numberOfLines={1} className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {item.subtitle}
                      </Text>
                    </View>

                    <ChevronRight size={18} color="#71717a" />
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        {/* API Health & Diagnostics Card */}
        <View className="rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] p-4 gap-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Activity size={16} color="#71717a" />
              <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                System Diagnostics
              </Text>
            </View>
            <Pressable
              onPress={() => void checkHealth()}
              disabled={checking}
              className="flex-row items-center gap-1.5 rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-100 dark:bg-white/5 px-2.5 py-1 active:opacity-75"
            >
              {checking ? (
                <Spinner size="sm" color="default" />
              ) : (
                <Text className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Run Check
                </Text>
              )}
            </Pressable>
          </View>

          {health ? (
            <View className="flex-row items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
              <View className="h-2 w-2 rounded-full bg-emerald-400" />
              <Text className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {health}
              </Text>
            </View>
          ) : error ? (
            <View className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2">
              <Text className="text-xs text-red-500 font-medium">{error}</Text>
            </View>
          ) : (
            <Text className="text-xs text-zinc-400">
              API endpoint connected. Tap &quot;Run Check&quot; to test live connectivity.
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
