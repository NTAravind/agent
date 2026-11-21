import type { TabTriggerSlotProps } from 'expo-router/ui';
import type { LucideIcon } from 'lucide-react-native';
import { Pressable, Text, View, type PressableProps } from 'react-native';

export type TabButtonProps = Omit<TabTriggerSlotProps, 'style'> & {
  icon: LucideIcon;
  label: string;
  badge?: number;
};

/**
 * A single tab button for the app's bottom tab bar.
 *
 * `isFocused` comes from the headless tab navigator (expo-router/ui), so the
 * button highlights itself without any extra state.
 */
export function TabButton({ icon: Icon, label, badge, isFocused, ref, ...props }: TabButtonProps) {
  const color = isFocused ? '#18181b' : '#71717a';

  return (
    <Pressable
      {...(props as PressableProps)}
      ref={ref as never}
      accessibilityRole="tab"
      accessibilityState={{ selected: Boolean(isFocused) }}
      accessibilityLabel={label}
      style={{
        flex: 1,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        gap: 3,
      }}
    >
      <View>
        <Icon size={21} color={color} strokeWidth={isFocused ? 2.4 : 2} />
        {badge && badge > 0 ? (
          <View
            style={{
              position: 'absolute',
              top: -4,
              right: -8,
              minWidth: 16,
              height: 16,
              paddingHorizontal: 4,
              borderRadius: 8,
              backgroundColor: '#ef4444',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '700' }}>
              {badge > 9 ? '9+' : badge}
            </Text>
          </View>
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        style={{
          fontSize: 10,
          fontWeight: isFocused ? '700' : '500',
          color,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
