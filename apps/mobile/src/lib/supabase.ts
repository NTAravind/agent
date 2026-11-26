import 'react-native-url-polyfill/auto';
import './polyfills';

import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';

export const isSupabaseConfigured = Boolean(
  process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
);

const createStorageAdapter = () => {
  if (Platform.OS === 'web') {
    return {
      getItem: (name: string) => {
        if (typeof window !== 'undefined' && window.localStorage) {
          return Promise.resolve(window.localStorage.getItem(name));
        }
        return Promise.resolve(null);
      },
      setItem: (name: string, value: string) => {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(name, value);
        }
        return Promise.resolve();
      },
      removeItem: (name: string) => {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(name);
        }
        return Promise.resolve();
      },
    };
  }

  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    return {
      getItem: (name: string) => SecureStore.getItemAsync(name),
      setItem: (name: string, value: string) => SecureStore.setItemAsync(name, value),
      removeItem: (name: string) => SecureStore.deleteItemAsync(name),
    };
  }

  return {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  };
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: createStorageAdapter(),
    flowType: 'pkce',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
