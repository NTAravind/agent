import { Pressable, StyleSheet } from 'react-native';
import Animated, { SlideInRight, SlideOutRight } from 'react-native-reanimated';

import { AGENT_LIST_ACTION_ICONS } from '@/constants/icons';
import { colors, radius, space } from '@/theme';

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

const ACTION_WIDTH = 48;
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
      style={({ pressed }) => [
        styles.actionButton,
        { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 },
      ]}
    >
      <Icon
        size={18}
        color={disabled ? colors.textTertiary : colors.textPrimary}
        strokeWidth={1.75}
      />
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
      style={styles.container}
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

const styles = StyleSheet.create({
  container: {
    width: TOTAL_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: space.xs,
  },
  actionButton: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
