import type { Agent, RoutineWithPreview } from '@agent/shared';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert as RNAlert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Spinner } from 'heroui-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  MoreHorizontal,
  Plus,
} from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';

import {
  AgentAvatar,
  AgentMark,
  CREATURE_SHAPES,
  PICKABLE_CREATURE_SHAPES,
  deriveCreatureConfig,
  type CreatureShape,
} from '@/components/agent-avatar';
import { AppHeader, useHeaderInset } from '@/components/app-header';
import {
  GroupedCard,
  HairlineDivider,
  InlineError,
  PillButton,
  RoundButton,
  SectionLabel,
  TextAction,
} from '@/components/design-system';
import { RoutineListSheet } from '@/components/routine-sheet';
import { reportAppError } from '@/components/error-dialog-provider';
import { colors, radius, shadow, space, typography } from '@/theme';
import {
  deleteAgent,
  fetchAgents,
  updateAgent,
} from '@/lib/agents';
import { fetchRoutines } from '@/lib/routines';
import { hapticSelect } from '@/lib/haptics';

// Exact order from design.md Section 3:
// black, brown, red, orange, amber, green, teal, blue, purple, pink, gray
const PALETTE_ORDER = [
  colors.mark.black,
  colors.mark.brown,
  colors.mark.red,
  colors.mark.orange,
  colors.mark.amber,
  colors.mark.green,
  colors.mark.teal,
  colors.mark.blue,
  colors.mark.purple,
  colors.mark.pink,
  colors.mark.gray,
];

export default function AgentDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [selectedShape, setSelectedShape] = useState<CreatureShape>('triangle');
  const [selectedColor, setSelectedColor] = useState<string>(colors.mark.green);
  const [routineSheetOpen, setRoutineSheetOpen] = useState(false);
  const [routines, setRoutines] = useState<RoutineWithPreview[]>([]);
  const [routinesLoading, setRoutinesLoading] = useState(true);
  const [instructionsModalOpen, setInstructionsModalOpen] = useState(false);
  const [instructionText, setInstructionText] = useState('');
  const [savingInstructions, setSavingInstructions] = useState(false);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/agents' as never);
    }
  }, [router]);

  useEffect(() => {
    if (id === 'new') {
      router.replace('/agents/new/edit');
    }
  }, [id, router]);

  const load = useCallback(async () => {
    if (id === 'new') return;
    try {
      const agents = await fetchAgents();
      const found = agents.find((a) => a.id === id) ?? null;
      setAgent(found);
      if (!found) {
        setError('Agent not found');
        return;
      }

      const creature = deriveCreatureConfig(found.name, found.avatar?.color);
      setSelectedShape(
        CREATURE_SHAPES.includes(found.avatar?.value as CreatureShape)
          ? (found.avatar?.value as CreatureShape)
          : creature.shape,
      );
      setSelectedColor(found.avatar?.color ?? creature.color);
      setInstructionText(found.instructions ?? '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  /** The agent's real routines — the screen never shows placeholder data. */
  const loadRoutines = useCallback(async () => {
    if (id === 'new') return;
    try {
      const items = await fetchRoutines();
      setRoutines(items.filter((routine) => routine.agentId === id));
    } catch {
      setRoutines([]);
    } finally {
      setRoutinesLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void loadRoutines();
    }, [load, loadRoutines]),
  );

  const handleUpdateAvatar = async (shape: CreatureShape, color: string) => {
    if (!agent) return;
    hapticSelect();
    setSelectedShape(shape);
    setSelectedColor(color);

    try {
      await updateAgent(agent.id, {
        avatar: {
          type: 'icon',
          value: shape,
          color,
        },
      });
    } catch (err) {
      reportAppError(err, { title: 'Could not update agent avatar' });
    }
  };

  const handleResetToDefault = async () => {
    if (!agent) return;
    const defaultCreature = deriveCreatureConfig(agent.name);
    setSelectedShape(defaultCreature.shape);
    setSelectedColor(defaultCreature.color);

    try {
      await updateAgent(agent.id, {
        avatar: {
          type: 'icon',
          value: defaultCreature.shape,
          color: defaultCreature.color,
        },
      });
    } catch (err) {
      reportAppError(err, { title: 'Could not reset agent avatar' });
    }
  };

  const handleSaveInstructions = async () => {
    if (!agent) return;
    setSavingInstructions(true);
    try {
      await updateAgent(agent.id, {
        instructions: instructionText,
      });
      setAgent((prev) => (prev ? { ...prev, instructions: instructionText } : prev));
      setInstructionsModalOpen(false);
    } catch (err) {
      reportAppError(err, { title: 'Could not save instructions' });
    } finally {
      setSavingInstructions(false);
    }
  };

  const handleDelete = () => {
    RNAlert.alert(
      'Delete this agent?',
      'MCP integrations attached to it will be removed. Run history is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            if (!agent) return;
            void (async () => {
              try {
                await deleteAgent(agent.id);
                router.replace('/agents' as never);
              } catch (err) {
                reportAppError(err, { title: 'Could not delete agent' });
              }
            })();
          },
        },
      ],
    );
  };

  const openMoreMenu = () => {
    RNAlert.alert(agent?.name ?? 'Agent Options', undefined, [
      { text: 'Edit Details', onPress: () => router.push({ pathname: '/agents/[id]/edit', params: { id } }) },
      { text: 'Delete agent', style: 'destructive', onPress: handleDelete },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (loading) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Spinner color="default" />
      </View>
    );
  }

  if (!agent) {
    return (
      <View style={[styles.screen, styles.center, { paddingHorizontal: space.lg }]}>
        <InlineError
          message={error ?? 'Agent not found'}
          align="center"
          style={styles.errorCard}
        />
        <PillButton label="Go back" onPress={handleBack} variant="secondary" style={{ marginTop: space.md }} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* 6.1 Settings Floating Header: round back button + Edit pill + round ellipsis */}
      <AppHeader
        left={
          <RoundButton
            icon={ChevronLeft}
            onPress={handleBack}
            accessibilityLabel="Go back"
          />
        }
        right={
          <View style={styles.headerRightActions}>
            <PillButton
              label="Edit"
              variant="secondary"
              onPress={() => router.push({ pathname: '/agents/[id]/edit', params: { id } })}
              accessibilityLabel="Edit agent"
            />
            <RoundButton
              icon={MoreHorizontal}
              onPress={openMoreMenu}
              accessibilityLabel="More options"
            />
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: headerInset,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Large Centered Hero Mark (~120pt) */}
        <View style={styles.heroMarkContainer}>
          <AgentAvatar
            forcedShape={selectedShape}
            forcedColor={selectedColor}
            size={120}
          />
        </View>

        {/* Agent Name & Role Card */}
        <View style={styles.nameCard}>
          <Text style={styles.agentNameText}>{agent.name}</Text>
          <Text style={styles.agentRoleText}>{agent.role || 'Personal assistant'}</Text>
        </View>

        {/* 6.7 Character Customizer */}
        <View>
          <SectionLabel text="Character" />
          <GroupedCard style={{ paddingVertical: space.lg, gap: space.lg }}>
            {/* 1. Palette: 11 circles, 36pt each, with 2pt #C8C8CC ring separated by 4pt gap */}
            <View style={styles.swatchesRow}>
              {PALETTE_ORDER.map((color) => {
                const isSelected = selectedColor.toLowerCase() === color.toLowerCase();
                return (
                  <Pressable
                    key={color}
                    onPress={() => void handleUpdateAvatar(selectedShape, color)}
                    accessibilityRole="button"
                    accessibilityLabel={`Color ${color}`}
                    style={styles.swatchTouch}
                  >
                    <View
                      style={[
                        styles.selectionRing,
                        isSelected && styles.selectionRingActive,
                      ]}
                    >
                      <View style={[styles.swatchCircle, { backgroundColor: color }]} />
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <HairlineDivider inset={0} />

            {/* 2. Shapes: Creature shape previews, 36pt each, rendered in selected color */}
            <View style={styles.shapesRow}>
              {PICKABLE_CREATURE_SHAPES.map((shape) => {
                const isSelected = selectedShape === shape;
                return (
                  <Pressable
                    key={shape}
                    onPress={() => void handleUpdateAvatar(shape, selectedColor)}
                    accessibilityRole="button"
                    accessibilityLabel={`Shape ${shape}`}
                    style={styles.shapeTouch}
                  >
                    <View
                      style={[
                        styles.selectionRing,
                        isSelected && styles.selectionRingActive,
                      ]}
                    >
                      <AgentMark shape={shape} color={selectedColor} size={36} />
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <HairlineDivider inset={0} />

            {/* 3. Caption: "How this agent's mark looks everywhere" (15pt, textSecondary, centered) */}
            <Text style={styles.captionText}>
              How this agent&apos;s mark looks everywhere
            </Text>

            {/* 4. Link: "Reset to default" in link color, centered, 17/400 */}
            <Pressable
              onPress={() => void handleResetToDefault()}
              accessibilityRole="button"
              accessibilityLabel="Reset to default character"
              style={{ alignItems: 'center' }}
            >
              <Text style={styles.resetLinkText}>Reset to default</Text>
            </Pressable>
          </GroupedCard>
        </View>

        {/* 6.6 Instructions Grouped Card */}
        <View>
          <GroupedCard>
            <Pressable
              onPress={() => setInstructionsModalOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Open instructions"
              style={({ pressed }) => [styles.navRow, { opacity: pressed ? 0.6 : 1 }]}
            >
              <View style={styles.navRowLeft}>
                <SymbolIcon icon={FileText} size={22} color={colors.textPrimary} strokeWidth={1.75} />
                <Text style={styles.rowTitle}>Instructions</Text>
              </View>
              <SymbolIcon icon={ChevronRight} size={17} color={colors.textSecondary} strokeWidth={2} />
            </Pressable>
          </GroupedCard>
        </View>

        {/* 6.9 Routines Section — the agent's real routines, never placeholders */}
        <View>
          <SectionLabel text="Routines" />
          <GroupedCard>
            {routinesLoading ? (
              <View style={styles.navRow}>
                <Spinner size="sm" />
              </View>
            ) : routines.length === 0 ? (
              <View style={styles.navRow}>
                <Text style={styles.routineEmpty}>No routines yet</Text>
              </View>
            ) : (
              routines.map((routine, index) => (
                <React.Fragment key={routine.id}>
                  {index > 0 && <HairlineDivider inset={60} />}
                  <Pressable
                    onPress={() => setRoutineSheetOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`${routine.name}, ${routine.scheduleLabel}`}
                    style={({ pressed }) => [styles.navRow, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <View style={styles.navRowLeft}>
                      <SymbolIcon icon={Clock} size={22} color={colors.textPrimary} strokeWidth={1.75} />
                      <View>
                        <Text style={styles.rowTitle}>{routine.name}</Text>
                        <Text style={styles.routineMeta}>{routine.scheduleLabel}</Text>
                      </View>
                    </View>
                    <SymbolIcon icon={ChevronRight} size={17} color={colors.textSecondary} strokeWidth={2} />
                  </Pressable>
                </React.Fragment>
              ))
            )}
          </GroupedCard>

          {/* Text action below the card: "+ Add routine" in link color */}
          <View style={{ marginTop: space.sm, paddingHorizontal: space.lg }}>
            <TextAction
              icon={Plus}
              label="Add routine"
              onPress={() => setRoutineSheetOpen(true)}
            />
          </View>
        </View>
      </ScrollView>

      {/* Routine Detail Sheet */}
      <RoutineListSheet
        visible={routineSheetOpen}
        onClose={() => setRoutineSheetOpen(false)}
        agentId={agent.id}
      />

      {/* Instructions Sheet / Modal conforming to 6.1 & 6.2 */}
      <Modal
        visible={instructionsModalOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setInstructionsModalOpen(false)}
      >
        <View style={[styles.modalScreen, { paddingTop: insets.top + space.md }]}>
          {/* Header with back button on left, Save pill on right */}
          <View style={styles.modalHeader}>
            <RoundButton
              icon={ChevronLeft}
              onPress={() => setInstructionsModalOpen(false)}
              inSheet
              accessibilityLabel="Close"
            />
            <Text style={styles.modalTitle}>Instructions</Text>
            <PillButton
              label={savingInstructions ? 'Saving…' : 'Save'}
              onPress={() => void handleSaveInstructions()}
              disabled={savingInstructions}
              variant="primary"
            />
          </View>

          {/* Grouped Surface Card with text input */}
          <View style={{ paddingHorizontal: space.lg, marginTop: space.lg }}>
            <GroupedCard style={{ paddingVertical: space.md, minHeight: 220 }}>
              <TextInput
                multiline
                value={instructionText}
                onChangeText={setInstructionText}
                placeholder="How this agent behaves, answers, and reasons..."
                placeholderTextColor={colors.textSecondary}
                style={styles.modalTextInput}
                textAlignVertical="top"
                autoFocus
              />
            </GroupedCard>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  heroMarkContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.md,
  },
  nameCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingVertical: space.lg,
    paddingHorizontal: space.xl,
  },
  agentNameText: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  agentRoleText: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '400',
    color: colors.textSecondary,
    marginTop: space.xs,
  },
  swatchesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xs,
  },
  swatchTouch: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
  },
  selectionRing: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selectionRingActive: {
    borderColor: '#C8C8CC',
  },
  swatchCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  shapesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: space.xs,
    paddingHorizontal: space.xs,
  },
  shapeTouch: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
  },
  captionText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  resetLinkText: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '400',
    color: colors.link,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
  },
  navRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  rowTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  routineMeta: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '400',
    color: colors.textSecondary,
    marginTop: 2,
  },
  routineEmpty: {
    fontSize: 17,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  modalScreen: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  modalTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  modalTextInput: {
    fontSize: 17,
    lineHeight: 22,
    color: colors.textPrimary,
    minHeight: 180,
  },
  errorCard: {
    maxWidth: 320,
  },
});
