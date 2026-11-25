import 'react-native-url-polyfill/auto';

import * as Crypto from 'expo-crypto';
import structuredClonePolyfill from '@ungap/structured-clone';
import { TextDecoderStream, TextEncoderStream } from '@stardazed/streams-text-encoding';
import {
  ReadableStream as PolyfillReadableStream,
  TransformStream as PolyfillTransformStream,
  WritableStream as PolyfillWritableStream,
} from 'web-streams-polyfill';

/**
 * Polyfills the AI SDK needs on React Native:
 * - crypto.getRandomValues (PKCE for Supabase OAuth)
 * - structuredClone (message parts)
 * - TextEncoderStream / TextDecoderStream (SSE parsing)
 * - ReadableStream / WritableStream / TransformStream (the XHR fallback transport)
 */

const globalScope = globalThis as Record<string, unknown>;

if (!globalScope.crypto) {
  Object.defineProperty(globalScope, "crypto", {
    value: {},
    configurable: true,
    writable: true,
  });
}

const cryptoGlobal = globalScope.crypto as { getRandomValues?: unknown; randomUUID?: unknown };
if (typeof cryptoGlobal.getRandomValues !== "function") {
  cryptoGlobal.getRandomValues = Crypto.getRandomValues;
}
if (typeof cryptoGlobal.randomUUID !== "function") {
  cryptoGlobal.randomUUID = Crypto.randomUUID;
}

if (typeof globalScope.structuredClone !== "function") {
  globalScope.structuredClone = structuredClonePolyfill;
}

if (typeof globalScope.TextEncoderStream !== "function") {
  globalScope.TextEncoderStream = TextEncoderStream;
}
if (typeof globalScope.TextDecoderStream !== "function") {
  globalScope.TextDecoderStream = TextDecoderStream;
}

if (typeof globalScope.ReadableStream !== "function") {
  globalScope.ReadableStream = PolyfillReadableStream;
}
if (typeof globalScope.WritableStream !== "function") {
  globalScope.WritableStream = PolyfillWritableStream;
}
if (typeof globalScope.TransformStream !== "function") {
  globalScope.TransformStream = PolyfillTransformStream;
}

// Global Text & TextInput accessibility cap (maxFontSizeMultiplier = 1.15)
try {
  const { Text, TextInput } = require('react-native');
  if (Text) {
    Text.defaultProps = Text.defaultProps || {};
    Text.defaultProps.maxFontSizeMultiplier = 1.15;
  }
  if (TextInput) {
    TextInput.defaultProps = TextInput.defaultProps || {};
    TextInput.defaultProps.maxFontSizeMultiplier = 1.15;
  }
} catch {
  // Ignore in environments without react-native
}

export {};
