import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Spinner } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookMarked, ChevronLeft, ChevronRight, Plus } from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';
import type { Skill } from '@agent/shared';

import { AppHeader, useHeaderInset } from '@/components/app-header';
import { HairlineDivider, InlineError, RoundButton } from '@/components/design-system';
import { colors, radius, space } from '@/theme';
import { fetchSkills } from '@/lib/skills';

/**
 * Skills list: reusable instruction bundles agents load on demand.
 * Stored in the GitHub vault at skills/<slug>/SKILL.md (Supabase is the index).
 */
export default function SkillsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSkills(await fetchSkills());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/more');
    }
  }, [router]);

  const headerInset = useHeaderInset();

  return (
    <View style={styles.screen}>
      <AppHeader
        left={
          <RoundButton
            icon={ChevronLeft}
            onPress={handleBack}
            accessibilityLabel="Close"
          />
        }
        center={
          <Text style={styles.headerTitle}>
            Skills
          </Text>
        }
        right={
          <RoundButton
            icon={Plus}
            onPress={() => router.push('/skills/new')}
            accessibilityLabel="New skill"
          />
        }
      />

      {loading ? (
        <View style={styles.center}>
          <Spinner size="lg" color="default" />
        </View>
      ) : (
        <FlatList
          data={skills}
          keyExtractor={(skill) => skill.id}
          renderItem={({ item: skill, index }) => (
            <View
              style={[
                styles.cardSlice,
                index === 0 && styles.cardSliceTop,
                index === skills.length - 1 && styles.cardSliceBottom,
              ]}
            >
              {index > 0 ? <HairlineDivider inset={56} /> : null}
              <Pressable
                onPress={() => router.push({ pathname: '/skills/[id]', params: { id: skill.id } })}
                accessibilityRole="button"
                accessibilityLabel={`Open ${skill.name}`}
                style={({ pressed }) => [
                  styles.skillRow,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <View style={styles.tileIcon}>
                  <SymbolIcon icon={BookMarked} size={18} color={colors.textSecondary} strokeWidth={1.75} />
                </View>
                <View style={styles.skillContent}>
                  <View style={styles.titleRow}>
                    <Text numberOfLines={1} style={styles.skillName}>
                      {skill.name}
                    </Text>
                    {!skill.enabled ? (
                      <View style={styles.disabledBadge}>
                        <Text style={styles.disabledText}>Off</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text numberOfLines={2} style={styles.skillDescription}>
                    {skill.description}
                  </Text>
                  <View style={styles.metaRow}>
                    <Text numberOfLines={1} style={styles.slugText}>
                      {skill.slug}
                      {skill.tools.length > 0 ? ` · ${skill.tools.length} tool limit` : ''}
                    </Text>
                    <View style={styles.agentBadge}>
                      <Text style={styles.agentBadgeText}>
                        {skill.assignedAgentIds.length} agent
                        {skill.assignedAgentIds.length === 1 ? '' : 's'}
                      </Text>
                    </View>
                  </View>
                </View>
                <SymbolIcon icon={ChevronRight} size={16} color={colors.textTertiary} strokeWidth={1.75} />
              </Pressable>
            </View>
          )}
          ListHeaderComponent={
            error ? (
              <InlineError message={error} onRetry={() => void load()} style={styles.headerError} />
            ) : undefined
          }
          ListEmptyComponent={
            skills.length === 0 && !error ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconBox}>
                  <SymbolIcon icon={BookMarked} size={32} color={colors.textSecondary} strokeWidth={1.5} />
                </View>
                <Text style={styles.emptyTitle}>
                  No skills yet
                </Text>
                <Text style={styles.emptySubtitle}>
                  Skills are reusable instruction bundles (SKILL.md in your vault). Agents only see
                  their name and description until they load one.
                </Text>
              </View>
            ) : undefined
          }
          contentContainerStyle={{
            paddingTop: headerInset,
            paddingHorizontal: space.lg,
            paddingBottom: insets.bottom + 32,
          }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.textPrimary}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerError: {
    // Replaces the content container's old 12pt gap below the error box.
    marginBottom: space.md,
  },
  cardSlice: {
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
  },
  cardSliceTop: {
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  cardSliceBottom: {
    borderBottomLeftRadius: radius.card,
    borderBottomRightRadius: radius.card,
  },
  emptyContainer: {
    marginTop: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: space.xs,
  },
  emptyIconBox: {
    width: 64,
    height: 64,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  emptyTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
  },
  skillRow: {
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
  skillContent: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  skillName: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    color: colors.textPrimary,
    flex: 1,
  },
  disabledBadge: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  disabledText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  skillDescription: {
    fontSize: 13,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xs,
    marginTop: 2,
  },
  slugText: {
    fontSize: 11,
    lineHeight: 14,
    color: colors.textTertiary,
    flex: 1,
    fontVariant: ['tabular-nums'],
  },
  agentBadge: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  agentBadgeText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
});
