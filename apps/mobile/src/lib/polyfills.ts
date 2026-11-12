import 'react-native-url-polyfill/auto';
import * as Crypto from 'expo-crypto';

// Hermes does not always expose the Web Crypto API that supabase-js needs for
// PKCE. Expo's implementation is available, so wire it up once at startup.
const cryptoGlobal = globalThis.crypto as (Crypto & { getRandomValues?: unknown }) | undefined;
if (!cryptoGlobal?.getRandomValues) {
  Object.defineProperty(globalThis, "crypto", {
    value: { ...(cryptoGlobal ?? {}), getRandomValues: Crypto.getRandomValues },
    configurable: true,
    writable: true,
  });
}
