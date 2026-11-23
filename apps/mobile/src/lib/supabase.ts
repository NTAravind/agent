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

// True while Expo Router evaluates this module in Node (server export / SSR).
const isServer = typeof window === 'undefined';
const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

const secureStoreAdapter = {
  getItem: (name: string) => SecureStore.getItemAsync(name),
  setItem: (name: string, value: string) => SecureStore.setItemAsync(name, value),
  removeItem: (name: string) => SecureStore.deleteItemAsync(name),
};

// No-op storage for the Node export step, so nothing touches the native module.
const noopStorage = {
  getItem: async (_name: string) => null,
  setItem: async (_name: string, _value: string) => {},
  removeItem: async (_name: string) => {},
};

// Native app -> SecureStore. Server export -> no-op. Web -> undefined (localStorage).
const storage = isServer ? noopStorage : isNative ? secureStoreAdapter : undefined;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    flowType: 'pkce',
    autoRefreshToken: !isServer,
    persistSession: !isServer,
    // Deep links are handled manually in the auth callback screen.
    detectSessionInUrl: false,
  },
});