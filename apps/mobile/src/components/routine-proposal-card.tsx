import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CalendarClock, Check, Pencil } from 'lucide-react-native';

import { PillButton } from '@/components/design-system';
import { formatDateTime } from '@/lib/dates';
import { activateRoutine } from '@/lib/routines';
import { colors, radius, space, typography } from '@/theme';

/**
 * The routine proposal card (Phase 10) conforming to design.md.
 * Monochrome surfaces, hairline dividers, green check for confirmed.
 */

export type RoutineProposal = {
  routineId: string;
  name: string;
  prompt: string;
  scheduleLabel: string;
  nextRuns: string[];
  tz: string;
  status: string;
};

type Props = {
  proposal: RoutineProposal;
  onEdit?: (routineId: string) => void;
};

export function RoutineProposalCard({ proposal, onEdit }: Props) {
  const [state, setState] = useState<'pending' | 'confirming' | 'confirmed' | 'error'>(
    'pending',
  );
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setState('confirming');
    setError(null);
    try {
      await activateRoutine(proposal.routineId);
      setState('confirmed');
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmed = state === 'confirmed';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <CalendarClock size={16} color={colors.textSecondary} strokeWidth={1.75} />
        <Text style={styles.title} numberOfLines={1}>
          {proposal.name}
        </Text>
        {confirmed ? (
          <View style={styles.confirmedBadge}>
            <Check size={13} color={colors.success} strokeWidth={2.2} />
            <Text style={styles.confirmedText}>Scheduled</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.scheduleText}>
        {proposal.scheduleLabel}
      </Text>

      {proposal.prompt ? (
        <Text style={styles.promptText}>
          {proposal.prompt}
        </Text>
      ) : null}

      {proposal.nextRuns.length > 0 ? (
        <View style={styles.nextRunsContainer}>
          <Text style={styles.nextRunsLabel}>
            Next runs
          </Text>
          {proposal.nextRuns.map((run) => (
            <Text key={run} style={styles.runDateText}>
              {formatDateTime(run, proposal.tz)}
            </Text>
          ))}
        </View>
      ) : null}

      {error ? (
        <Text style={styles.errorText}>
          {error}
        </Text>
      ) : null}

      {!confirmed ? (
        <View style={styles.actions}>
          <PillButton
            label={state === 'confirming' ? 'Confirming…' : 'Confirm'}
            onPress={() => void confirm()}
            disabled={state === 'confirming'}
          />
          {onEdit ? (
            <Pressable
              onPress={() => onEdit(proposal.routineId)}
              accessibilityRole="button"
              accessibilityLabel="Edit this routine"
              style={({ pressed }) => [
                styles.editButton,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Pencil size={14} color={colors.textPrimary} strokeWidth={1.75} />
              <Text style={styles.editText}>Edit</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginVertical: space.xs,
    gap: space.sm,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceRaised,
    padding: space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  title: {
    flex: 1,
    ...typography.rowTitle,
    fontSize: 16,
    lineHeight: 20,
  },
  confirmedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  confirmedText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.success,
  },
  scheduleText: {
    ...typography.bodySecondary,
    fontSize: 14,
    lineHeight: 18,
  },
  promptText: {
    ...typography.bodySecondary,
    fontSize: 14,
    lineHeight: 18,
  },
  nextRunsContainer: {
    gap: 4,
    borderRadius: radius.inner,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  nextRunsLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  runDateText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  errorText: {
    fontSize: 13,
    color: colors.recording,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.xs,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
  },
  editText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
});
