import { Pressable } from 'react-native';
import Animated, { SlideInRight, SlideOutRight } from 'react-native-reanimated';
import { useThemeColor } from 'heroui-native';

import { AGENT_LIST_ACTION_ICONS } from '@/constants/icons';

type ActionType = 'pause' | 'skip' | 'notify';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onActionPress: (action: ActionType) => void;
  /** Optimistic pause state — pause icon flips to play. */
  isPaused?: boolean;
  /** Optimistic notification state — bell flips to bell-off. */
  notificationsEnabled?: boolean;
  /** Run-scoped actions are disabled while there is no active run. */
  runActionsDisabled?: boolean;
};

const ACTION_WIDTH = 56;
const TOTAL_WIDTH = ACTION_WIDTH * 3;

/**
 * Action pill revealed by swiping left (or long-pressing) an agent row:
 * pause/resume, skip current step and notifications toggle.
 * Only one row may have it open at a time — the parent owns that state and
 * tapping elsewhere closes it. Slides in/out with Reanimated.
 */
export function AgentRowActions({
  isOpen,
  onClose,
  onActionPress,
  isPaused = false,
  notificationsEnabled = true,
  runActionsDisabled = false,
}: Props) {
  const iconColor = useThemeColor('foreground');
  const mutedColor = useThemeColor('muted');

  if (!isOpen) return null;

  const renderActionButton = (
    label: string,
    Icon: (typeof AGENT_LIST_ACTION_ICONS)[keyof typeof AGENT_LIST_ACTION_ICONS],
    action: ActionType,
    disabled: boolean,
  ) => (
    <Pressable
      onPress={() => {
        if (disabled) return;
        onActionPress(action);
        onClose();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={
        disabled && action !== 'notify'
          ? 'No active run to act on'
          : action === 'pause'
            ? isPaused
              ? 'Currently paused'
              : 'Currently running'
            : action === 'notify'
              ? notificationsEnabled
                ? 'Currently on'
                : 'Currently off'
              : undefined
      }
      className="flex-1 items-center justify-center h-12 rounded-full active:opacity-60"
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Icon size={18} color={disabled ? mutedColor : iconColor} strokeWidth={2} />
    </Pressable>
  );

  const PausePlayIcon = isPaused
    ? AGENT_LIST_ACTION_ICONS.play
    : AGENT_LIST_ACTION_ICONS.pause;
  const BellIcon = notificationsEnabled
    ? AGENT_LIST_ACTION_ICONS.bell
    : AGENT_LIST_ACTION_ICONS.bellOff;

  return (
    <Animated.View
      entering={SlideInRight.duration(200)}
      exiting={SlideOutRight.duration(200)}
      className="flex-row items-center rounded-full border border-border bg-surface px-1"
      style={{ width: TOTAL_WIDTH }}
    >
      {renderActionButton(
        isPaused ? 'Resume the run' : 'Pause the run',
        PausePlayIcon,
        'pause',
        runActionsDisabled,
      )}
      {renderActionButton(
        'Skip the current step',
        AGENT_LIST_ACTION_ICONS.skipForward,
        'skip',
        runActionsDisabled,
      )}
      {renderActionButton(
        notificationsEnabled ? 'Turn notifications off' : 'Turn notifications on',
        BellIcon,
        'notify',
        false,
      )}
    </Animated.View>
  );
}