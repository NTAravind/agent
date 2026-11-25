import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Haptics (design.md "Motion & haptics").
 *
 * Two flavours only:
 * - `hapticTap` — a committed action (send a message, confirm a choice).
 * - `hapticSelect` — a value changed in place (a swatch, a shape, a chip).
 *
 * iOS uses the Taptic Engine, Android uses the device haptics engine
 * (`performAndroidHapticsAsync`, which does not need the VIBRATE permission),
 * and web falls back to the Vibration API. Every call is fire-and-forget:
 * haptics are a nicety, never a dependency, so failures are swallowed.
 */

function safe(run: () => Promise<unknown>): void {
  try {
    void run().catch(() => {});
  } catch {
    // Haptics are unavailable on some devices/emulators — never break the action.
  }
}

/** Light impact for a committed action. */
export function hapticTap(): void {
  if (Platform.OS === 'android') {
    safe(() => Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm));
    return;
  }
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Selection tick for an in-place value change. */
export function hapticSelect(): void {
  if (Platform.OS === 'android') {
    safe(() => Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick));
    return;
  }
  safe(() => Haptics.selectionAsync());
}
