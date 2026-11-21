import type { LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { Typography, useThemeColor } from 'heroui-native';

import { AGENT_OVERVIEW_ICONS, SLEEP_ICON } from '@/constants/icons';

type Props = {
  /** The agent these actions belong to (kept for future per-agent prefs). */
  agentName: string;
  isPaused: boolean;
  /** True when there is no active run to pause/resume. */
  pauseDisabled?: boolean;
  onPauseToggle: () => void;
  notificationsEnabled: boolean;
  onNotificationsToggle: () => void;
  isSleeping: boolean;
  onSleepToggle: () => void;
  memoryEnabled: boolean;
  onMemoryToggle: () => void;
};

type QuickAction = {
  key: string;
  icon: LucideIcon;
  offIcon?: LucideIcon;
  label: string;
  caption: string;
  active: boolean;
  onPress: () => void;
  /** Renders the tile inert (dimmed, not focusable as actionable). */
  disabled?: boolean;
  hint?: string;
};

/**
 * Quick-action row on the agent overview: 4 square rounded-xl tiles —
 * pause/resume (server-backed per active run), notifications, sleep/wake
 * (same glyph as the chat header details button) and memory on/off. Each
 * tile is a switch with an active state, an accessibility label and a
 * short caption.
 */
export function AgentQuickActions({
  agentName,
  isPaused,
  pauseDisabled = false,
  onPauseToggle,
  notificationsEnabled,
  onNotificationsToggle,
  isSleeping,
  onSleepToggle,
  memoryEnabled,
  onMemoryToggle,
}: Props) {
  const foreground = useThemeColor('foreground');
  const accent = useThemeColor('accent');
  const border = useThemeColor('border');

  const actions: QuickAction[] = [
    {
      key: 'pause',
      icon: isPaused ? AGENT_OVERVIEW_ICONS.play : AGENT_OVERVIEW_ICONS.pause,
      label: `${isPaused ? 'Resume' : 'Pause'} ${agentName}`,
      caption: isPaused ? 'Resume' : 'Pause',
      active: isPaused,
      onPress: onPauseToggle,
      disabled: pauseDisabled,
      hint: pauseDisabled
        ? 'No active task to pause right now.'
        : isPaused
          ? 'Pauses the active task. Double tap to resume it from where it stopped.'
          : 'Pauses the active task at its next step. Double tap to resume it.',
    },
    {
      key: 'notifications',
      icon: notificationsEnabled
        ? AGENT_OVERVIEW_ICONS.bell
        : AGENT_OVERVIEW_ICONS.bellOff,
      label: `${notificationsEnabled ? 'Disable' : 'Enable'} notifications for ${agentName}`,
      caption: 'Notify',
      active: notificationsEnabled,
      onPress: onNotificationsToggle,
    },
    {
      key: 'sleep',
      icon: SLEEP_ICON,
      label: `${isSleeping ? 'Wake' : 'Sleep'} ${agentName}`,
      caption: 'Sleep',
      active: isSleeping,
      onPress: onSleepToggle,
      hint: isSleeping
        ? 'Agent is asleep: tasks are paused. Double tap to wake it and resume them.'
        : 'Sleeps the agent: pauses all of its tasks and blocks new ones until it wakes.',
    },
    {
      key: 'memory',
      icon: memoryEnabled
        ? AGENT_OVERVIEW_ICONS.brain
        : AGENT_OVERVIEW_ICONS.brainOff,
      label: `${memoryEnabled ? 'Disable' : 'Enable'} memory for ${agentName}`,
      caption: 'Memory',
      active: memoryEnabled,
      onPress: onMemoryToggle,
    },
  ];

  return (
    <View className="w-full flex-row gap-3">
      {actions.map(({ key, icon: Icon, label, caption, active, onPress, disabled, hint }) => (
        <Pressable
          key={key}
          onPress={disabled ? undefined : onPress}
          disabled={disabled}
          accessibilityRole="switch"
          accessibilityLabel={label}
          accessibilityState={{ checked: active, disabled: disabled ?? false }}
          accessibilityHint={
            hint ??
            (active
              ? 'Currently on. Double tap to turn off.'
              : 'Currently off. Double tap to turn on.')
          }
          className={`flex-1 aspect-square items-center justify-center gap-1 rounded-xl border ${
            disabled ? 'opacity-40' : 'active:opacity-70'
          }`}
          style={{
            backgroundColor: 'transparent',
            borderColor: active ? accent : border,
          }}
        >
          <Icon size={22} color={active ? accent : foreground} strokeWidth={2} />
          <Typography
            type="body-xs"
            color={active ? 'default' : 'muted'}
            weight={active ? 'semibold' : 'normal'}
            align="center"
          >
            {caption}
          </Typography>
        </Pressable>
      ))}
    </View>
  );
}