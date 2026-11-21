import { useState } from 'react';
import { Button, Typography } from 'heroui-native';
import { Pressable, View } from 'react-native';
import { CalendarClock, Check, Pencil } from 'lucide-react-native';

import { formatDateTime } from '@/lib/dates';
import { activateRoutine } from '@/lib/routines';

/**
 * The routine proposal card (Phase 10).
 *
 * When the agent proposes a schedule, the app shows this card: the name, the
 * human-readable schedule and the next three runs. Nothing recurring starts
 * until the user taps Confirm.
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
    <View className="my-1 gap-3 rounded-2xl border border-sky-500/25 bg-sky-500/5 p-3.5">
      <View className="flex-row items-center gap-2">
        <CalendarClock size={16} color="#38bdf8" />
        <Typography type="body-sm" weight="semibold" className="flex-1 text-sky-200">
          {proposal.name}
        </Typography>
        {confirmed ? (
          <View className="flex-row items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5">
            <Check size={11} color="#4ade80" />
            <Typography type="body-xs" className="text-emerald-300">
              Scheduled
            </Typography>
          </View>
        ) : null}
      </View>

      <Typography type="body-xs" className="text-zinc-300">
        {proposal.scheduleLabel}
      </Typography>

      {proposal.prompt ? (
        <Typography type="body-xs" className="text-zinc-400">
          {proposal.prompt}
        </Typography>
      ) : null}

      {proposal.nextRuns.length > 0 ? (
        <View className="gap-1 rounded-xl border border-white/5 bg-black/20 px-3 py-2">
          <Typography type="body-xs" className="text-zinc-500">
            Next runs
          </Typography>
          {proposal.nextRuns.map((run) => (
            <Typography key={run} type="body-xs" className="text-zinc-300">
              {formatDateTime(run, proposal.tz)}
            </Typography>
          ))}
        </View>
      ) : null}

      {error ? (
        <Typography type="body-xs" className="text-red-400">
          {error}
        </Typography>
      ) : null}

      {!confirmed ? (
        <View className="flex-row items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            className="rounded-full px-3"
            onPress={() => void confirm()}
            isDisabled={state === 'confirming'}
            accessibilityRole="button"
            accessibilityLabel="Confirm this routine"
          >
            <Button.Label>{state === 'confirming' ? 'Confirming…' : 'Confirm'}</Button.Label>
          </Button>
          {onEdit ? (
            <Pressable
              onPress={() => onEdit(proposal.routineId)}
              accessibilityRole="button"
              accessibilityLabel="Edit this routine"
              className="flex-row items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 active:bg-white/10"
            >
              <Pencil size={12} color="#a1a1aa" />
              <Typography type="body-xs" className="text-zinc-300">
                Edit
              </Typography>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
