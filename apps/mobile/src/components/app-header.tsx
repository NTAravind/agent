import type { ReactNode } from 'react';
import { BlurView } from 'expo-blur';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  /** Left-hand control (usually an icon button or drawer toggle). */
  left?: ReactNode;
  /** Centred content — a title or model capsule picker. */
  center?: ReactNode;
  /** Right-hand control. */
  right?: ReactNode;
  /** Extra bottom padding, e.g. for a hairline + spacing. */
  bottomInset?: number;
};

/**
 * Grok-inspired translucent frosted header.
 * Uses BlurView with a dark obsidian tint and hairline border.
 */
export function AppHeader({ left, center, right, bottomInset = 0 }: Props) {
  const insets = useSafeAreaInsets();

  const content = (
    <View
      className="border-b border-white/10 px-3.5 pb-2.5"
      style={{ paddingTop: insets.top + 6, paddingBottom: 10 + bottomInset }}
    >
      <View className="h-11 flex-row items-center justify-between gap-2">
        <View className="min-w-10 flex-row items-center justify-start">{left}</View>
        <View className="flex-1 items-center justify-center">{center}</View>
        <View className="min-w-10 flex-row items-center justify-end">{right}</View>
      </View>
    </View>
  );

  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={70} tint="dark" className="bg-[#09090b]/60">
        {content}
      </BlurView>
    );
  }

  // Android / Web fallback
  return <View className="bg-[#09090b]/95">{content}</View>;
}
