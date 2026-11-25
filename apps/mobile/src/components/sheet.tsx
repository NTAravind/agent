import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { RoundButton } from '@/components/design-system';
import { colors, radius, space } from '@/theme';

type SheetProps = {
  /** Shows and hides the sheet. */
  visible: boolean;
  /** Backdrop tap, close button and Android back all land here. */
  onClose: () => void;
  /** Extra surface style — pass a fixed `height` for scrollable sheets. */
  style?: StyleProp<ViewStyle>;
  /** Accessibility label for the dim backdrop. */
  backdropLabel?: string;
  children: ReactNode;
};

/**
 * 6.8 Bottom sheet: slides up over an `overlay` dim, top radius 32, handle pill
 * on top, `surfaceRaised` fill. Never a centered modal (DESIGN §11 checklist).
 *
 * Keyboard avoidance lives here — iOS `padding`, Android relies on the window
 * resizing (`softwareKeyboardLayoutMode: "resize"`) — so sheet content can just
 * lay itself out. A scrollable sheet needs a bounded height: pass one through
 * `style`, otherwise its inner scroll view has no height to scroll within.
 */
export function Sheet({
  visible,
  onClose,
  style,
  backdropLabel = 'Close sheet',
  children,
}: SheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel={backdropLabel}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />

        <View
          style={[
            styles.container,
            { paddingBottom: Math.max(insets.bottom + space.md, space.xl) },
            style,
          ]}
        >
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.body}
          >
            {children}
          </KeyboardAvoidingView>
        </View>
      </View>
    </Modal>
  );
}

type SheetHeaderProps = {
  onClose: () => void;
  closeLabel?: string;
  /** Middle of the row: a sheet title, or the pill search field (§6.9). */
  children?: ReactNode;
  /** Optional right-side control — §6.8's ellipsis slot. */
  right?: ReactNode;
};

/**
 * 6.8/6.9 Top row of a sheet: round close button (X) on the left, `surface`
 * fill, no shadow (round buttons inside sheets use `inSheet`).
 */
export function SheetHeader({
  onClose,
  closeLabel = 'Close',
  children,
  right,
}: SheetHeaderProps) {
  return (
    <View style={styles.headerRow}>
      <RoundButton icon={X} onPress={onClose} inSheet accessibilityLabel={closeLabel} />
      {children ? <View style={styles.headerMiddle}>{children}</View> : null}
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  container: {
    maxHeight: '88%',
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: space.sm,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: space.xs,
  },
  handle: {
    width: 36,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.divider,
  },
  body: {
    flexGrow: 1,
    // Let the body shrink inside `maxHeight` so an inner ScrollView keeps its
    // scroll bound (ScrollView only shrinks when its parent is constrained).
    flexShrink: 1,
    gap: space.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  headerMiddle: {
    flex: 1,
  },
});
