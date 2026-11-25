import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Spinner } from 'heroui-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Activity,
  BookMarked,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Database,
  Layers,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Sun,
  Users,
} from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';

import { AppHeader, HeaderAvatar, useHeaderInset } from '@/components/app-header';
import { GroupedCard, HairlineDivider, RoundButton, SectionLabel } from '@/components/design-system';
import { colors, radius, shadow, space } from '@/theme';
import { apiFetchDebug, ApiRequestError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function MoreScreen() {
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

  const headerInset = useHeaderInset();

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Spinner size="lg" color="default" />
      </View>
    );
  }

  const email = session?.user.email ?? session?.user.id ?? '';
  const initial = email.slice(0, 2).toUpperCase() || 'FL';

  const handleLogout = useCallback(() => {
    Alert.alert(
      'Sign out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
      ],
    );
  }, [signOut]);

  const NAV_GROUPS = [
    {
      title: 'Productivity',
      items: [
        {
          title: 'Today',
          subtitle: 'Agenda, due tasks and quick capture',
          icon: Sun,
          route: '/',
        },
        {
          title: 'Tasks',
          subtitle: 'Lists, subtasks, due dates & priorities',
          icon: ListTodo,
          route: '/tasks',
        },
        {
          title: 'Calendar',
          subtitle: 'Month, week and agenda — with recurrence',
          icon: CalendarDays,
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
          route: '/canvas',
        },
        {
          title: 'Routines',
          subtitle: 'Scheduled agent runs that post back into their chat',
          icon: CalendarClock,
          route: '/routines',
        },
        {
          title: 'Groups',
          subtitle: 'Multi-agent chats with handoffs and shared context',
          icon: Users,
          route: '/groups',
        },
        {
          title: 'Integrations (MCP)',
          subtitle: 'Connect web search, databases, APIs & tool servers',
          icon: Layers,
          route: '/mcp',
        },
        {
          title: 'Skills',
          subtitle: 'Reusable instruction bundles agents load on demand',
          icon: BookMarked,
          route: '/skills',
        },
        {
          title: 'Agent memory',
          subtitle: 'Durable facts, preferences and decisions',
          icon: Database,
          route: '/memories',
        },
      ],
    },
  ];


  return (
    <View style={styles.screen}>
      <AppHeader
        left={<HeaderAvatar initial={initial} />}
        center={<Text style={styles.headerTitle}>More</Text>}
        right={
          <Pressable
            onPress={handleLogout}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            hitSlop={4}
            style={({ pressed }) => [
              styles.logoutButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <SymbolIcon icon={LogOut} size={20} color={colors.textSecondary} strokeWidth={1.75} />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{
          paddingTop: headerInset,
          paddingHorizontal: space.lg,
          paddingBottom: insets.bottom + 100,
          gap: space.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* User Account Card */}
        <View style={styles.profileCard}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>{initial}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileTitle}>Connected account</Text>
            <Text numberOfLines={1} style={styles.profileEmail}>
              {email}
            </Text>
          </View>
        </View>

        {/* Navigation Groups */}
        {NAV_GROUPS.map((group) => (
          <View key={group.title}>
            <SectionLabel text={group.title} />
            <GroupedCard>
              {group.items.map((item, index) => {
                return (
                  <React.Fragment key={item.title}>
                    {index > 0 && <HairlineDivider inset={60} />}
                    <Pressable
                      onPress={() => router.push(item.route as never)}
                      accessibilityRole="button"
                      accessibilityLabel={item.title}
                      style={({ pressed }) => [
                        styles.navRow,
                        { opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <View style={styles.tileIcon}>
                        <SymbolIcon icon={item.icon} size={18} color={colors.textPrimary} strokeWidth={1.75} />
                      </View>
                      <View style={styles.navContent}>
                        <Text style={styles.navTitle}>{item.title}</Text>
                        <Text numberOfLines={1} style={styles.navSubtitle}>
                          {item.subtitle}
                        </Text>
                      </View>
                      <SymbolIcon icon={ChevronRight} size={16} color={colors.textTertiary} strokeWidth={1.75} />
                    </Pressable>
                  </React.Fragment>
                );
              })}
            </GroupedCard>
          </View>
        ))}

        {/* Diagnostics */}
        <View>
          <SectionLabel text="System diagnostics" />
          <GroupedCard style={{ padding: space.md, gap: space.sm }}>
            <View style={styles.diagHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                <SymbolIcon icon={Activity} size={16} color={colors.textSecondary} strokeWidth={1.75} />
                <Text style={styles.diagTitle}>Backend API status</Text>
              </View>
              <Pressable
                onPress={() => void checkHealth()}
                disabled={checking}
                accessibilityRole="button"
                accessibilityLabel="Run API health check"
                style={({ pressed }) => [
                  styles.diagCheckButton,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
              >
                {checking ? (
                  <Spinner size="sm" color="default" />
                ) : (
                  <Text style={styles.diagCheckText}>Run check</Text>
                )}
              </Pressable>
            </View>

            {health ? (
              <View style={styles.diagSuccess}>
                <View style={styles.statusDot} />
                <Text style={styles.diagSuccessText}>{health}</Text>
              </View>
            ) : error ? (
              <View style={styles.diagError}>
                <Text style={styles.diagErrorText}>{error}</Text>
              </View>
            ) : (
              <Text style={styles.diagPlaceholder}>
                Tap &quot;Run check&quot; to test API gateway connectivity.
              </Text>
            )}
          </GroupedCard>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  headerTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  logoutButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: space.md,
  },
  profileAvatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.profileAvatar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarText: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  profileInfo: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  profileTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  profileEmail: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.tile,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navContent: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  navTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '400',
    color: colors.textPrimary,
  },
  navSubtitle: {
    fontSize: 17,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  diagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  diagTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  diagCheckButton: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  diagCheckText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  diagSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.inner,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
  },
  diagSuccessText: {
    fontSize: 13,
    color: colors.success,
    fontWeight: '500',
  },
  diagError: {
    borderRadius: radius.inner,
    backgroundColor: colors.surface,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
  },
  diagErrorText: {
    fontSize: 13,
    color: colors.danger,
  },
  diagPlaceholder: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});
