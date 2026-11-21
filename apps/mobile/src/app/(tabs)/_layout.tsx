import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Tabs, TabList, TabSlot, TabTrigger } from 'expo-router/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bot, FileText, MessageSquare, MoreHorizontal, Sun } from 'lucide-react-native';

import { TabButton } from '@/components/tab-button';
import { useSession } from '@/lib/session';

/**
 * The app's bottom tab bar (Phase 9).
 *
 * Five tabs replace the old home-hub sprawl:
 *   Chat · Agents · Today · Notes · More
 *
 * Detail screens (agent detail, note editor, tasks, calendar) stay in the
 * root stack so deep links such as /agents/:id keep working.
 */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, isLoading } = useSession();

  // One guard for every tab: an unauthenticated user never sees the app.
  useEffect(() => {
    if (!isLoading && !session) {
      router.replace('/sign-in');
    }
  }, [isLoading, session, router]);

  return (
    <Tabs>
      <TabSlot />
      <TabList
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 6),
          borderTopWidth: 1,
          borderTopColor: 'rgba(113,113,122,0.18)',
          backgroundColor: '#ffffff',
        }}
      >
        <TabTrigger name="chat" href="/chat" asChild>
          <TabButton icon={MessageSquare} label="Chat" />
        </TabTrigger>
        <TabTrigger name="agents" href="/agents" asChild>
          <TabButton icon={Bot} label="Agents" />
        </TabTrigger>
        <TabTrigger name="today" href="/" asChild>
          <TabButton icon={Sun} label="Today" />
        </TabTrigger>
        <TabTrigger name="notes" href="/notes" asChild>
          <TabButton icon={FileText} label="Notes" />
        </TabTrigger>
        <TabTrigger name="more" href="/more" asChild>
          <TabButton icon={MoreHorizontal} label="More" />
        </TabTrigger>
      </TabList>
    </Tabs>
  );
}
