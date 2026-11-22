import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppHeader } from '@/components/app-header';
import { GroupEditor } from '@/components/group-editor';

/** Edits a dynamic agent group's metadata and membership. */
export default function EditGroupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  return (
    <View className="flex-1 bg-white dark:bg-[#09090b]">
      <AppHeader
        left={
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            className="px-2 py-1 active:opacity-60"
          >
            <Text className="text-base text-zinc-500 dark:text-zinc-400">Cancel</Text>
          </Pressable>
        }
        center={<Text className="text-sm font-semibold text-zinc-900 dark:text-white">Edit Group</Text>}
      />
      <GroupEditor
        groupId={id}
        onSaved={() => router.back()}
        onDeleted={() => router.replace('/groups' as never)}
      />
    </View>
  );
}
