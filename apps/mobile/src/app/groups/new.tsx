import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppHeader } from '@/components/app-header';
import { GroupEditor } from '@/components/group-editor';

/** Creates a dynamic agent group. */
export default function NewGroupScreen() {
  const router = useRouter();

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
        center={<Text className="text-sm font-semibold text-zinc-900 dark:text-white">New Group</Text>}
      />
      <GroupEditor
        onSaved={(group) => router.replace({ pathname: '/groups/[id]', params: { id: group.id } } as never)}
      />
    </View>
  );
}
