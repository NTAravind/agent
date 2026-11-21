import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Spinner, Typography } from 'heroui-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { exchangeCode } from '@/lib/auth';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!code) {
        setError('No authorization code in the redirect.');
        return;
      }
      try {
        await exchangeCode(code);
        if (!cancelled) router.replace('/');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [code, router]);

  return (
    <View className="flex-1 items-center justify-center bg-[#0B0C0E] px-6 gap-3">
      {error ? (
        <View className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 max-w-[320px]">
          <Typography type="body-sm" className="text-center text-red-400">
            {error}
          </Typography>
        </View>
      ) : (
        <Spinner size="lg" color="default" />
      )}
      <Typography type="body-sm" className="text-white/60">
        Signing you in…
      </Typography>
    </View>
  );
}
