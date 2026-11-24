import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react-native';

import { PillButton } from '@/components/design-system';
import { describeError, type FriendlyError } from '@/lib/error-message';
import { colors, radius, shadow, space, typography } from '@/theme';

export type ErrorDialogOptions = {
  title?: string;
  retry?: () => void | Promise<void>;
  retryLabel?: string;
};

type ErrorReporter = (error: unknown, options?: ErrorDialogOptions) => void;
let activeReporter: ErrorReporter | null = null;

/** Imperative bridge for non-component helpers and screen callbacks. */
export function reportAppError(error: unknown, options?: ErrorDialogOptions): void {
  if (activeReporter) activeReporter(error, options);
  else console.error('Unpresented app error:', error);
}

type CurrentError = FriendlyError & {
  retry?: () => void | Promise<void>;
  retryLabel: string;
};

type ErrorDialogContextValue = {
  showError: (error: unknown, options?: ErrorDialogOptions) => void;
};

const ErrorDialogContext = createContext<ErrorDialogContextValue | null>(null);

export function useErrorDialog(): ErrorDialogContextValue {
  const context = useContext(ErrorDialogContext);
  if (!context) throw new Error('useErrorDialog must be used inside ErrorDialogProvider.');
  return context;
}

export function ErrorDialogProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<CurrentError | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const close = useCallback(() => {
    if (retrying) return;
    setCurrent(null);
    setShowDetails(false);
  }, [retrying]);

  const showError = useCallback((error: unknown, options: ErrorDialogOptions = {}) => {
    const friendly = describeError(error, options.title);
    setShowDetails(false);
    setCurrent({
      ...friendly,
      retry: options.retry,
      retryLabel: options.retryLabel ?? 'Try again',
    });
    void AccessibilityInfo.announceForAccessibility(`${friendly.title}. ${friendly.message}`);
  }, []);

  const onRetry = useCallback(async () => {
    if (!current?.retry) return;
    setRetrying(true);
    try {
      await current.retry();
      setCurrent(null);
      setShowDetails(false);
    } catch (error) {
      const friendly = describeError(error);
      setCurrent((previous) => previous ? { ...friendly, retry: previous.retry, retryLabel: previous.retryLabel } : null);
    } finally {
      setRetrying(false);
    }
  }, [current]);

  const value = useMemo(() => ({ showError }), [showError]);

  useEffect(() => {
    activeReporter = showError;
    return () => {
      if (activeReporter === showError) activeReporter = null;
    };
  }, [showError]);

  return (
    <ErrorDialogContext.Provider value={value}>
      {children}
      <Modal
        visible={Boolean(current)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={close}
      >
        <View style={styles.overlay}>
          <View
            accessibilityViewIsModal
            accessibilityRole="alert"
            style={styles.dialog}
          >
            <View style={styles.iconWrap}>
              <AlertTriangle size={22} color={colors.recording} strokeWidth={1.8} />
            </View>
            <Text accessibilityRole="header" style={styles.title}>{current?.title}</Text>
            <Text style={styles.message}>{current?.message}</Text>

            {current?.details ? (
              <View style={styles.detailsWrap}>
                <Pressable
                  onPress={() => setShowDetails((open) => !open)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showDetails }}
                  style={styles.detailsToggle}
                >
                  <Text style={styles.detailsToggleText}>Technical details</Text>
                  {showDetails
                    ? <ChevronUp size={18} color={colors.textSecondary} />
                    : <ChevronDown size={18} color={colors.textSecondary} />}
                </Pressable>
                {showDetails ? (
                  <ScrollView style={styles.detailsScroll}>
                    <Text selectable style={styles.detailsText}>{current.details}</Text>
                  </ScrollView>
                ) : null}
              </View>
            ) : null}

            <View style={styles.actions}>
              {current?.retry ? (
                <PillButton
                  label={retrying ? 'Retrying…' : current.retryLabel}
                  onPress={() => void onRetry()}
                  disabled={retrying}
                  style={styles.primaryAction}
                />
              ) : null}
              <PillButton
                label={current?.retry ? 'Close' : 'Got it'}
                variant={current?.retry ? 'secondary' : 'primary'}
                onPress={close}
                disabled={retrying}
                style={styles.secondaryAction}
              />
            </View>
          </View>
        </View>
      </Modal>
    </ErrorDialogContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    backgroundColor: colors.overlay,
  },
  dialog: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '85%',
    padding: space.xl,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    ...shadow.floating,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.recordingBg,
    marginBottom: space.md,
  },
  title: {
    ...typography.sheetTitle,
    textAlign: 'center',
  },
  message: {
    ...typography.bodySecondary,
    textAlign: 'center',
    marginTop: space.sm,
  },
  detailsWrap: {
    alignSelf: 'stretch',
    marginTop: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  detailsToggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailsToggleText: {
    ...typography.meta,
    color: colors.textPrimary,
  },
  detailsScroll: {
    maxHeight: 120,
    borderRadius: radius.inner,
    backgroundColor: colors.surface,
    padding: space.md,
  },
  detailsText: {
    ...typography.meta,
    color: colors.textSecondary,
  },
  actions: {
    alignSelf: 'stretch',
    gap: space.sm,
    marginTop: space.xl,
  },
  primaryAction: {
    width: '100%',
  },
  secondaryAction: {
    width: '100%',
  },
});
