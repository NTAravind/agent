import { useState } from 'react';
import { Spinner, Typography } from 'heroui-native';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Lock,
  Mail,
  Sparkles,
} from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';

import { AppHeader } from '@/components/app-header';
import { authRedirectUrl, signInWithEmail, signInWithGitHub, signUpWithEmail } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useKeyboardHeight } from '@/lib/use-keyboard-height';

type Mode = 'sign-in' | 'sign-up';

function GitHubIcon({ size = 18, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
        fill={color}
      />
    </Svg>
  );
}

export default function SignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();

  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleEmailAuth = () =>
    run(async () => {
      if (!email.trim() || !password) {
        throw new Error('Enter an email address and password.');
      }
      if (mode === 'sign-up') {
        await signUpWithEmail(email.trim(), password);
        setNotice('Account created — you can now sign in.');
        setMode('sign-in');
        return;
      }
      await signInWithEmail(email.trim(), password);
    });

  const bottomPadding = keyboardHeight > 0 ? 16 : insets.bottom + 24;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-[#0B0C0E]"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppHeader
        left={
          router.canGoBack() ? (
            <Pressable
              onPress={() => router.back()}
              className="h-10 w-10 items-center justify-center rounded-full bg-white/10 active:opacity-70"
              accessibilityLabel="Go back"
            >
              <ArrowLeft size={20} color="#fff" />
            </Pressable>
          ) : null
        }
      />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 12,
          paddingBottom: bottomPadding,
          gap: 16,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* Glowing Brand Mark */}
        <View className="items-center pt-4 pb-2">
          <View className="h-16 w-16 items-center justify-center rounded-3xl border border-white/10 bg-white/5 shadow-2xl">
            <Sparkles size={28} color="#fff" />
          </View>
          <Typography type="h2" className="mt-4 font-bold tracking-tight text-white text-center">
            {mode === 'sign-in' ? 'Welcome back' : 'Create your account'}
          </Typography>
          <Typography type="body-sm" className="mt-1 text-center text-white/50 max-w-[280px]">
            {mode === 'sign-in'
              ? 'Sign in to access your autonomous agent workspace.'
              : 'Sign up with an allow-listed email to get started.'}
          </Typography>
        </View>

        {/* Mode Switcher */}
        <View className="flex-row rounded-full border border-white/10 bg-white/5 p-1">
          <Pressable
            onPress={() => {
              setMode('sign-in');
              setError(null);
            }}
            className={`flex-1 items-center justify-center rounded-full py-2.5 ${
              mode === 'sign-in' ? 'bg-white shadow-sm' : ''
            }`}
          >
            <Typography
              type="body-sm"
              className={`font-semibold ${mode === 'sign-in' ? 'text-black' : 'text-white/60'}`}
            >
              Sign In
            </Typography>
          </Pressable>
          <Pressable
            onPress={() => {
              setMode('sign-up');
              setError(null);
            }}
            className={`flex-1 items-center justify-center rounded-full py-2.5 ${
              mode === 'sign-up' ? 'bg-white shadow-sm' : ''
            }`}
          >
            <Typography
              type="body-sm"
              className={`font-semibold ${mode === 'sign-up' ? 'text-black' : 'text-white/60'}`}
            >
              Create Account
            </Typography>
          </Pressable>
        </View>

        {/* Inputs */}
        <View className="gap-3">
          <View className="flex-row items-center rounded-2xl border border-white/10 bg-[#16171B] px-4 py-3">
            <Mail size={18} color="rgba(255,255,255,0.4)" />
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="rgba(255,255,255,0.3)"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={!busy}
              className="ml-3 flex-1 text-base text-white"
            />
          </View>

          <View className="flex-row items-center rounded-2xl border border-white/10 bg-[#16171B] px-4 py-3">
            <Lock size={18} color="rgba(255,255,255,0.4)" />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor="rgba(255,255,255,0.3)"
              secureTextEntry
              textContentType="password"
              editable={!busy}
              className="ml-3 flex-1 text-base text-white"
            />
          </View>
        </View>

        {/* Primary Action Button */}
        <Pressable
          onPress={() => void handleEmailAuth()}
          disabled={busy || !isSupabaseConfigured}
          className={`items-center justify-center rounded-full py-4 ${
            busy || !isSupabaseConfigured ? 'bg-white/30' : 'bg-white active:opacity-90'
          }`}
        >
          {busy ? (
            <Spinner size="sm" color="default" />
          ) : (
            <Typography type="body-sm" className="font-semibold text-black">
              {mode === 'sign-up' ? 'Create Account' : 'Sign In with Email'}
            </Typography>
          )}
        </Pressable>

        {/* Divider */}
        <View className="my-1 flex-row items-center gap-3">
          <View className="h-px flex-1 bg-white/10" />
          <Typography type="body-xs" className="text-white/40">
            or continue with
          </Typography>
          <View className="h-px flex-1 bg-white/10" />
        </View>

        {/* GitHub OAuth Button */}
        <Pressable
          onPress={() => void run(signInWithGitHub)}
          disabled={busy || !isSupabaseConfigured}
          className="flex-row items-center justify-center gap-2.5 rounded-full border border-white/10 bg-[#16171B] py-3.5 active:bg-white/10"
        >
          <GitHubIcon size={18} color="#fff" />
          <Typography type="body-sm" className="font-semibold text-white">
            GitHub
          </Typography>
        </Pressable>

        {/* Alerts */}
        {!isSupabaseConfigured ? (
          <View className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
            <View className="flex-row items-center gap-2">
              <AlertCircle size={16} color="#FBBF24" />
              <Typography type="body-sm" className="font-semibold text-amber-300">
                Supabase not configured
              </Typography>
            </View>
            <Typography type="body-xs" className="mt-1 text-amber-300/80">
              Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in apps/mobile/.env
            </Typography>
          </View>
        ) : null}

        {error ? (
          <View className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
            <View className="flex-row items-center gap-2">
              <AlertCircle size={16} color="#F87171" />
              <Typography type="body-sm" className="font-semibold text-red-300">
                Sign-in failed
              </Typography>
            </View>
            <Typography type="body-xs" className="mt-1 text-red-300/80">
              {error}
            </Typography>
          </View>
        ) : null}

        {notice ? (
          <View className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
            <View className="flex-row items-center gap-2">
              <CheckCircle2 size={16} color="#34D399" />
              <Typography type="body-sm" className="font-semibold text-emerald-300">
                Notice
              </Typography>
            </View>
            <Typography type="body-xs" className="mt-1 text-emerald-300/80">
              {notice}
            </Typography>
          </View>
        ) : null}

        <View className="mt-2 rounded-2xl border border-white/5 bg-[#131418] p-3.5 gap-1">
          <Typography type="body-xs" className="font-semibold text-white/70">
            Development build note
          </Typography>
          <Typography type="body-xs" className="text-white/40 leading-relaxed">
            Expo Go cannot handle custom OAuth schemes. With a dev build (npx expo run:android/ios), GitHub OAuth redirects to:
          </Typography>
          <Typography type="body-xs" className="font-mono text-white/50 text-[11px] mt-0.5">
            {authRedirectUrl}
          </Typography>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
