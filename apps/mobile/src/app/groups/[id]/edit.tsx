import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';

import { AppHeader, useHeaderInset } from '@/components/app-header';
import { RoundButton } from '@/components/design-system';
import { GroupEditor } from '@/components/group-editor';
import { colors } from '@/theme';

/** Edits a dynamic agent group's metadata and membership. */
export default function EditGroupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(id ? ({ pathname: '/groups/[id]', params: { id } } as never) : ('/agents' as never));
    }
  }, [id, router]);

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
        center={<Text style={styles.headerTitle}>Edit group</Text>}
      />
      <View style={{ height: headerInset }} />
      <GroupEditor
        groupId={id}
        onSaved={handleBack}
        onDeleted={() => router.replace('/agents' as never)}
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
