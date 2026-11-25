import { useEffect } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { Tabs, TabList, TabSlot, TabTrigger } from 'expo-router/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FileText, MessageSquare, MoreHorizontal, Sun, Users } from 'lucide-react-native';

import { TabButton } from '@/components/tab-button';
import { useSession } from '@/lib/session';
import { colors, radius, shadow } from '@/theme';

/**
 * Pill-Shaped Floating Navigation Dock conforming to design.md:
 * - Direct child of <Tabs> so Expo Router's trigger discovery parses all tabs.
 * - Exactly centered on all device screen widths.
 * - 5 core tabs: Chat, Agents, Today, Notes, More.
 * - Seamlessly hidden when inside deep chat threads or sub-screens.
 */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useGlobalSearchParams<{ agentId?: string; threadId?: string }>();
  const { session, isLoading } = useSession();

  // One guard for every tab: unauthenticated user redirected to sign-in
  useEffect(() => {
    if (!isLoading && !session) {
      router.replace('/sign-in');
    }
  }, [isLoading, session, router]);

  // Is this an active conversation inside chat?
  const isAgentChat =
    (pathname === '/chat' || pathname.startsWith('/chat')) &&
    Boolean(searchParams.agentId || searchParams.threadId);

  // Nav dock appears exclusively on the 5 main root screens
  const isMainScreen =
    !isAgentChat &&
    (pathname === '/' ||
      pathname === '/chat' ||
      pathname === '/agents' ||
      pathname === '/notes' ||
      pathname === '/more');

  const screenWidth = Dimensions.get('window').width;
  const dockWidth = Math.min(screenWidth - 32, 380);

  return (
    <Tabs>
      <TabSlot />
      <TabList
        style={[
          styles.dock,
          {
            backgroundColor: colors.primary,
            bottom: Math.max(insets.bottom, 16),
            left: (screenWidth - dockWidth) / 2,
            width: dockWidth,
          },
          !isMainScreen && styles.dockHidden,
        ]}
      >
        <TabTrigger name="chat" href="/chat" asChild>
          <TabButton icon={MessageSquare} label="Chat" />
        </TabTrigger>
        <TabTrigger name="agents" href="/agents" asChild>
          <TabButton icon={Users} label="Agents" />
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

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    zIndex: 999,
    // DESIGN.md §5: elevation stays 0 on Android too — no elevation look.
    ...shadow.floating,
  },
  dockHidden: {
    display: 'none',
  },
});
