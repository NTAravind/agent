import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  /** Left-hand control (usually a 48px icon button). */
  left?: ReactNode;
  /** Centred content — a title or a control. */
  center?: ReactNode;
  /** Right-hand control. */
  right?: ReactNode;
  /** Extra bottom padding, e.g. for a hairline + spacing. */
  bottomInset?: number;
};

/**
 * Safe-area aware screen header.
 *
 * The top inset keeps the content clear of the status bar / notch, and the
 * row is 48px tall so every control keeps a comfortable touch target.
 */
export function AppHeader({ left, center, right }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View className="border-b border-separator bg-background px-3 pb-2" style={{ paddingTop: insets.top + 6 }}>
      <View className="h-12 flex-row items-center justify-between gap-2">
        <View className="min-w-12 flex-row items-center justify-start">{left}</View>
        <View className="flex-1 items-center justify-center">{center}</View>
        <View className="min-w-12 flex-row items-center justify-end">{right}</View>
      </View>
    </View>
  );
}
