/**
 * Design Language for the App (Expo / React Native, Android first)
 * Single source of truth for design tokens.
 */
import { StyleSheet } from 'react-native';

export const colors = {
  // Surfaces
  background: '#FCFCFC',       // screen background (near white, not pure white)
  backgroundFade: 'rgba(252,252,252,0)', // same RGB as background at 0 alpha — gradient fades
  surface: '#F3F3F3',          // cards, grouped rows, agent bubbles, input fields
  surfaceRaised: '#FFFFFF',    // floating round buttons, header pill, sheets, option list
  profileAvatar: '#E5E5E7',    // initials avatar fill
  overlay: 'rgba(0,0,0,0.20)', // dim behind bottom sheets

  // Text
  textPrimary: '#0A0A0A',
  textSecondary: '#6B6B70',    // section labels, previews, timestamps, placeholders (darkened for WCAG AA)
  textTertiary: '#B5B5BA',     // file extensions, disabled

  // Lines
  divider: '#E2E2E4',          // hairline (StyleSheet.hairlineWidth), inset from left edge

  // Actions
  primary: '#111111',          // primary buttons, user bubble, send button
  onPrimary: '#FFFFFF',
  link: '#2F6BDB',             // text actions ("Add member", "Reset to default") and hyperlinks
  success: '#4CAF6A',          // check mark on selected option, online status dot
  danger: '#E8404A',           // errors, failed states, destructive actions, attention badges
  recording: '#E8404A',        // recording square + timer text only
  recordingBg: '#FBE9EA',      // recording pill background

  // Agent mark palette (the ONLY decorative color in the app)
  mark: {
    black:  '#000000',
    brown:  '#8B6743',
    red:    '#E8404A',
    orange: '#EE7230',
    amber:  '#F0A030',
    green:  '#5BC87C',
    teal:   '#52B8A8',
    blue:   '#3B82F6',
    purple: '#8B5CF6',
    pink:   '#EC4899',
    gray:   '#777777',
  },
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  pill: 999,       // inputs, tags, buttons, header pill, round buttons
  card: 16,        // section cards, grouped settings cards
  cardLarge: 24,   // large surfaces
  bubble: 18,      // chat message bubbles
  inner: 16,       // option list inside a bubble
  sheet: 32,       // bottom sheets and popovers (top corners)
  tile: 10,        // small icon tiles (file icon, A-E badges)
} as const;

export const shadow = {
  floating: {      // round buttons, header pill, popovers
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 0,  // keep the quiet iOS-style elevation; no Android shadow look
  },
} as const;

export const maxFontSizeMultiplier = 1.15;
export const TAB_BAR_HEIGHT = 64;
export const HEADER_BAR_HEIGHT = 52;

export const typography = {
  // Global Type Scale (Section 1)
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  headerTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400' as const,
    color: colors.textPrimary,
  },
  bodyMedium: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500' as const,
    color: colors.textPrimary,
  },
  bodySemibold: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  secondary: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400' as const,
    color: colors.textSecondary,
  },
  secondaryMedium: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500' as const,
    color: colors.textSecondary,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400' as const,
    color: colors.textSecondary,
  },
  sectionLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.5,
    marginTop: 16,
    color: colors.textSecondary,
  },

  // Semantic & backwards-compatible aliases
  screenTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  sheetTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  rowTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  bodySecondary: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400' as const,
    color: colors.textSecondary,
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400' as const,
    color: colors.textSecondary,
  },
  button: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600' as const,
    color: colors.divider,
  },
  tagPill: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400' as const,
    color: colors.textSecondary,
  },
} as const;
