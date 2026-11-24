import { useCallback, useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Lock,
  Mail,
} from 'lucide-react-native';

import { AppHeader } from '@/components/app-header';
import { Image } from 'expo-image';
import { PillButton, RoundButton } from '@/components/design-system';
import { colors, radius, shadow, space } from '@/theme';
import { signInWithEmail, signUpWithEmail } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';

export default function SignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/' as never);
    }
  }, [router]);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setKeyboardHeight(e.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      if (mode === 'sign-in') {
        router.replace('/');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleEmailAuth = () =>
    run(async () => {
      const cleanEmail = email.trim();
      if (!cleanEmail || !password) {
        throw new Error('Enter an email address and password.');
      }
      if (mode === 'sign-up') {
        const needsConfirmation = await signUpWithEmail(cleanEmail, password);
        setNotice(
          needsConfirmation
            ? 'Check your email to confirm your account, then sign in.'
            : 'Account created — you can now sign in.',
        );
        setMode('sign-in');
        return;
      }
      await signInWithEmail(cleanEmail, password);
    });

  const bottomPadding = keyboardHeight > 0 ? 16 : insets.bottom + 24;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppHeader
        left={
          router.canGoBack() ? (
            <RoundButton
              icon={ChevronLeft}
              onPress={handleBack}
              accessibilityLabel="Go back"
            />
          ) : null
        }
      />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: space.sm,
          paddingBottom: bottomPadding,
          gap: space.md,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* Brand Mark */}
        <View style={styles.brandContainer}>
          <Image
            source={require('@/assets/images/icon.png')}
            style={styles.brandIcon}
            contentFit="cover"
            accessibilityLabel="Pacbot logo"
          />
          <Text style={styles.brandTitle}>
            {mode === 'sign-in' ? 'Welcome back' : 'Create your account'}
          </Text>
          <Text style={styles.brandSubtitle}>
            {mode === 'sign-in'
              ? 'Sign in to access your agent workspace.'
              : 'Create the first account for this single-user app.'}
          </Text>
        </View>

        {/* Mode Switcher */}
        <View style={styles.modeSwitcher}>
          <Pressable
            onPress={() => {
              setMode('sign-in');
              setError(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Switch to Sign In"
            style={[
              styles.modeTab,
              mode === 'sign-in' && styles.modeTabActive,
            ]}
          >
            <Text
              style={[
                styles.modeTabText,
                mode === 'sign-in' && styles.modeTabTextActive,
              ]}
            >
              Sign In
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setMode('sign-up');
              setError(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Switch to Create Account"
            style={[
              styles.modeTab,
              mode === 'sign-up' && styles.modeTabActive,
            ]}
          >
            <Text
              style={[
                styles.modeTabText,
                mode === 'sign-up' && styles.modeTabTextActive,
              ]}
            >
              Create Account
            </Text>
          </Pressable>
        </View>

        {/* Inputs */}
        <View style={{ gap: space.sm }}>
          <View style={styles.inputPill}>
            <Mail size={18} color={colors.textSecondary} />
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={!busy}
              style={styles.textInput}
            />
          </View>

          <View style={styles.inputPill}>
            <Lock size={18} color={colors.textSecondary} />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry
              textContentType="password"
              editable={!busy}
              style={styles.textInput}
            />
          </View>
        </View>

        {/* Primary Action Button */}
        <PillButton
          label={
            busy
              ? 'Please wait…'
              : mode === 'sign-up'
                ? 'Create Account'
                : 'Sign In'
          }
          onPress={() => void handleEmailAuth()}
          disabled={busy || !isSupabaseConfigured}
          variant="primary"
          style={{ height: 52 }}
        />

        {/* Alerts */}
        {!isSupabaseConfigured ? (
          <View style={styles.alertNotice}>
            <AlertCircle size={16} color={colors.textSecondary} />
            <Text style={styles.alertText}>
              Supabase not configured. Set EXPO_PUBLIC_SUPABASE_URL and ANON_KEY in .env
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorNotice}>
            <AlertCircle size={16} color={colors.recording} />
            <Text style={styles.errorNoticeText}>{error}</Text>
          </View>
        ) : null}

        {notice ? (
          <View style={styles.successNotice}>
            <CheckCircle2 size={16} color={colors.success} />
            <Text style={styles.successNoticeText}>{notice}</Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  brandContainer: {
    alignItems: 'center',
    paddingTop: space.sm,
    paddingBottom: space.xs,
  },
  brandIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    overflow: 'hidden',
  },
  brandTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: space.md,
    textAlign: 'center',
  },
  brandSubtitle: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
    marginTop: space.xs,
    textAlign: 'center',
    maxWidth: 280,
  },
  modeSwitcher: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    padding: 4,
  },
  modeTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingVertical: 10,
  },
  modeTabActive: {
    backgroundColor: colors.surfaceRaised,
    ...shadow.floating,
  },
  modeTabText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  modeTabTextActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  inputPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    height: 52,
    gap: space.sm,
  },
  textInput: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  alertNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    padding: space.md,
  },
  alertText: {
    fontSize: 13,
    color: colors.textSecondary,
    flex: 1,
  },
  errorNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.card,
    backgroundColor: colors.recordingBg,
    padding: space.md,
  },
  errorNoticeText: {
    fontSize: 14,
    color: colors.recording,
    flex: 1,
  },
  successNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    padding: space.md,
  },
  successNoticeText: {
    fontSize: 14,
    color: colors.textPrimary,
    flex: 1,
  },
});
