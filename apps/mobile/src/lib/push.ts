import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { registerPushToken } from '@/lib/productivity';

/**
 * Push notifications (Phase 9).
 *
 * Remote push requires a development build (Expo Go cannot receive remote
 * notifications on Android since SDK 53), so every step here is defensive:
 * the app must work exactly the same when notifications are unavailable.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Resolves the EAS project id used to mint Expo push tokens. */
function projectId(): string | undefined {
  return (
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
    (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
    (Constants.easConfig?.projectId as string | undefined) ??
    undefined
  );
}

/**
 * Requests permission, mints an Expo push token and registers it with the
 * API. Safe to call on every launch: the API upserts the token.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  // Simulators and Expo Go cannot hold a push token.
  if (!Device.isDevice) return null;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;

  try {
    // Android 13+ requires a channel to exist before the permission prompt.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        // eslint-disable-next-line import/namespace -- re-exported through `export *`, not statically resolvable
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') return null;

    const easProjectId = projectId();
    if (!easProjectId) {
      console.warn('[push] No EAS project id — skipping push token registration.');
      return null;
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId: easProjectId })).data;
    await registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
    return token;
  } catch (error) {
    console.warn('[push] Could not register for push notifications:', error);
    return null;
  }
}

/**
 * Re-registers the token when the push service rotates it.
 */
export function watchPushToken(onToken: (token: string) => void) {
  return Notifications.addPushTokenListener(({ data }) => {
    onToken(data);
  });
}
