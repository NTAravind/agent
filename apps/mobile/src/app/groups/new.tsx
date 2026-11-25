import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';

import { AppHeader, useHeaderInset } from '@/components/app-header';
import { RoundButton } from '@/components/design-system';
import { GroupEditor } from '@/components/group-editor';
import { colors } from '@/theme';

/** Creates a dynamic agent group. */
export default function NewGroupScreen() {
  const router = useRouter();

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/agents' as never);
    }
  }, [router]);

  const headerInset = useHeaderInset();

  return (
    <View style={styles.screen}>
      <AppHeader
        left={
          <RoundButton
            icon={ChevronLeft}
            onPress={handleBack}
            accessibilityLabel="Cancel"
          />
        }
        center={<Text style={styles.headerTitle}>New group</Text>}
      />
      <View style={{ height: headerInset }} />
      <GroupEditor
        onSaved={(group) => router.replace({ pathname: '/groups/[id]', params: { id: group.id } } as never)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
