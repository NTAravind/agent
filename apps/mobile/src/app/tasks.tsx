import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Spinner } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, FolderPlus, ListTodo, Plus, Trash2, X } from 'lucide-react-native';
import { SymbolIcon } from '@/components/symbol-icon';
import type { Task, TaskList } from '@agent/shared';

import { AppHeader, useHeaderInset } from '@/components/app-header';
import { reportAppError } from '@/components/error-dialog-provider';
import { HairlineDivider, InlineError, PillButton, RoundButton } from '@/components/design-system';
import { TaskRow } from '@/components/task-row';
import { colors, radius, shadow, space } from '@/theme';
import { createTask, createTaskList, deleteTask, fetchTaskLists, fetchTasks, updateTask } from '@/lib/productivity';

/**
 * One row of the virtualized task list. The hierarchy is flattened into
 * cells in render order (task, its actions, then each child preceded by a
 * divider), and each cell renders its own slice of the grouped card.
 */
type TaskCell =
  | {
      key: string;
      type: 'task';
      task: Task;
      depth: number;
      first: boolean;
      last: boolean;
    }
  | { key: string; type: 'actions'; task: Task; first: boolean; last: boolean }
  | { key: string; type: 'divider'; inset: number; first: boolean; last: boolean };

export default function TasksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [lists, setLists] = useState<TaskList[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftParentId, setDraftParentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [draftListName, setDraftListName] = useState('');

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/' as never);
    }
  }, [router]);

  const load = useCallback(async () => {
    try {
      const [taskLists, allTasks] = await Promise.all([fetchTaskLists(), fetchTasks()]);
      setLists(taskLists);
      setTasks(allTasks);
      setActiveListId((current) => current ?? taskLists[0]?.id ?? null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const listTasks = useMemo(
    () => tasks.filter((task) => !activeListId || task.listId === activeListId),
    [activeListId, tasks],
  );

  const roots = useMemo(
    () => listTasks.filter((task) => !task.parentId),
    [listTasks],
  );

  const childrenOf = useCallback(
    (parentId: string) => listTasks.filter((task) => task.parentId === parentId),
    [listTasks],
  );

  const handleToggle = useCallback(
    async (task: Task) => {
      const nextStatus: Task['status'] = task.status === 'done' ? 'open' : 'done';
      setTasks((current) =>
        current.map((item) => (item.id === task.id ? { ...item, status: nextStatus } : item)),
      );
      try {
        await updateTask(task.id, { status: nextStatus });
      } catch (error) {
        reportAppError(error, { title: 'Could not update task' });
        setTasks((current) =>
          current.map((item) => (item.id === task.id ? { ...item, status: task.status } : item)),
        );
      }
    },
    [],
  );

  const handleAdd = useCallback(async () => {
    const title = draftTitle.trim();
    if (!title) return;
    const targetListId = activeListId ?? lists[0]?.id;
    if (!targetListId) {
      setNotice('Please create a list first.');
      return;
    }
    setSaving(true);
    try {
      const created = await createTask({
        title,
        listId: targetListId,
        parentId: draftParentId ?? undefined,
      });
      setTasks((current) => [created, ...current]);
      setDraftTitle('');
      setDraftParentId(null);
      setComposerOpen(false);
    } catch (error) {
      reportAppError(error, { title: 'Could not add task' });
    } finally {
      setSaving(false);
    }
  }, [activeListId, draftParentId, draftTitle]);

  const handleDelete = useCallback(
    (task: Task) => {
      Alert.alert('Delete task', `Remove “${task.title}”?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteTask(task.id)
              .then(() => setTasks((current) => current.filter((item) => item.id !== task.id)))
              .catch((error) =>
                reportAppError(error, { title: 'Could not delete task' }),
              );
          },
        },
      ]);
    },
    [],
  );

  const handleAddList = useCallback(() => {
    setDraftListName('');
    setListModalOpen(true);
  }, []);

  const handleSaveList = useCallback(async () => {
    const name = draftListName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const created = await createTaskList({ name });
      setLists((current) => [...current, created]);
      setActiveListId(created.id);
      setListModalOpen(false);
      setDraftListName('');
    } catch (error) {
      reportAppError(error, { title: 'Could not create list' });
    } finally {
      setSaving(false);
    }
  }, [draftListName]);

  const headerInset = useHeaderInset();

  // Flatten the task tree into virtualizable cells, in the same order the
  // old recursive render produced: task, its actions row, then each child
  // preceded by a divider.
  const taskCells = useMemo<TaskCell[]>(() => {
    const cells: TaskCell[] = [];

    const emit = (task: Task, depth: number) => {
      cells.push({
        key: `task-${task.id}`,
        type: 'task',
        task,
        depth,
        first: false,
        last: false,
      });
      cells.push({
        key: `actions-${task.id}`,
        type: 'actions',
        task,
        first: false,
        last: false,
      });
      childrenOf(task.id).forEach((child) => {
        cells.push({
          key: `divider-${child.id}`,
          type: 'divider',
          inset: 48,
          first: false,
          last: false,
        });
        emit(child, depth + 1);
      });
    };

    roots.forEach((task, index) => {
      if (index > 0) {
        cells.push({
          key: `divider-root-${task.id}`,
          type: 'divider',
          inset: 0,
          first: false,
          last: false,
        });
      }
      emit(task, 0);
    });

    return cells.map((cell, index) => ({
      ...cell,
      first: index === 0,
      last: index === cells.length - 1,
    }));
  }, [roots, childrenOf]);

  return (
    <View style={styles.screen}>
      <AppHeader
        left={
          <RoundButton
            icon={ChevronLeft}
            onPress={handleBack}
            accessibilityLabel="Go back"
          />
        }
        center={
          <Text style={styles.headerTitle}>Tasks</Text>
        }
        right={
          <RoundButton
            icon={Plus}
            onPress={() => {
              setDraftParentId(null);
              setComposerOpen(true);
            }}
            accessibilityLabel="New task"
          />
        }
      />

      <FlatList
        data={loading || roots.length === 0 ? [] : taskCells}
        keyExtractor={(cell) => cell.key}
        renderItem={({ item: cell }) => (
          <View
            style={[
              styles.cardSlice,
              cell.first && styles.cardSliceTop,
              cell.last && styles.cardSliceBottom,
            ]}
          >
            {cell.type === 'task' ? (
              <View style={cell.depth > 0 ? styles.taskIndent : undefined}>
                <TaskRow
                  task={cell.task}
                  onToggle={(t) => void handleToggle(t)}
                  listName={undefined}
                />
              </View>
            ) : null}

            {cell.type === 'actions' ? (
              <View style={styles.subtaskActionsRow}>
                <Pressable
                  onPress={() => {
                    setDraftParentId(cell.task.id);
                    setComposerOpen(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Add subtask"
                  style={styles.subtaskAction}
                >
                  <SymbolIcon icon={Plus} size={14} color={colors.textSecondary} />
                  <Text style={styles.subtaskActionText}>Subtask</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleDelete(cell.task)}
                  accessibilityRole="button"
                  accessibilityLabel="Delete task"
                  style={styles.subtaskAction}
                >
                  <SymbolIcon icon={Trash2} size={14} color={colors.danger} />
                </Pressable>
              </View>
            ) : null}

            {cell.type === 'divider' ? <HairlineDivider inset={cell.inset} /> : null}
          </View>
        )}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {/* List chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipsRow}>
                {lists.map((list) => {
                  const active = list.id === activeListId;
                  return (
                    <Pressable
                      key={list.id}
                      onPress={() => setActiveListId(list.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Filter ${list.name}`}
                      style={[
                        styles.chip,
                        active && styles.chipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          active && styles.chipTextActive,
                        ]}
                      >
                        {list.name}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={handleAddList}
                  accessibilityRole="button"
                  accessibilityLabel="New list"
                  style={styles.addListChip}
                >
                  <SymbolIcon icon={FolderPlus} size={14} color={colors.textSecondary} />
                  <Text style={styles.addListChipText}>List</Text>
                </Pressable>
              </View>
            </ScrollView>

            {notice ? <InlineError message={notice} onRetry={() => void load()} /> : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.center}>
              <Spinner size="lg" color="default" />
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconBox}>
                <SymbolIcon icon={ListTodo} size={32} color={colors.textSecondary} strokeWidth={1.5} />
              </View>
              <Text style={styles.emptyTitle}>No tasks yet</Text>
              <Text style={styles.emptySubtitle}>
                Tap + to add your first task, or ask an agent to create one for you.
              </Text>
            </View>
          )
        }
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: headerInset,
          paddingBottom: insets.bottom + space.xxl,
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.textPrimary}
          />
        }
      />

      {/* Composer Modal */}
      <Modal visible={composerOpen} transparent animationType="fade" onRequestClose={() => setComposerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalCardHeader}>
              <Text style={styles.modalCardTitle}>
                {draftParentId ? 'New subtask' : 'New task'}
              </Text>
              <Pressable
                onPress={() => setComposerOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <SymbolIcon icon={X} size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <TextInput
              autoFocus
              style={styles.modalInput}
              placeholder="What needs doing?"
              placeholderTextColor={colors.textSecondary}
              value={draftTitle}
              onChangeText={setDraftTitle}
              onSubmitEditing={() => void handleAdd()}
              returnKeyType="done"
            />
            <PillButton
              label={saving ? 'Adding…' : 'Add task'}
              onPress={() => void handleAdd()}
              disabled={saving || !draftTitle.trim()}
              variant="primary"
            />
          </View>
        </View>
      </Modal>

      {/* New list Modal */}
      <Modal visible={listModalOpen} transparent animationType="fade" onRequestClose={() => setListModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalCardHeader}>
              <Text style={styles.modalCardTitle}>New list</Text>
              <Pressable
                onPress={() => setListModalOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <SymbolIcon icon={X} size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <TextInput
              autoFocus
              style={styles.modalInput}
              placeholder="List name"
              placeholderTextColor={colors.textSecondary}
              value={draftListName}
              onChangeText={setDraftListName}
              onSubmitEditing={() => void handleSaveList()}
              returnKeyType="done"
            />
            <PillButton
              label={saving ? 'Creating…' : 'Create list'}
              onPress={() => void handleSaveList()}
              disabled={saving || !draftListName.trim()}
              variant="primary"
            />
          </View>
        </View>
      </Modal>
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
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingRight: space.sm,
  },
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.primary,
  },
  chipText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.onPrimary,
  },
  addListChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addListChipText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  center: {
    paddingVertical: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listHeader: {
    gap: space.md,
    // Replaces the content container's old 12pt gap below the header.
    marginBottom: space.md,
  },
  cardSlice: {
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
  },
  cardSliceTop: {
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    // The old GroupedCard's vertical padding.
    paddingTop: space.sm,
  },
  cardSliceBottom: {
    borderBottomLeftRadius: radius.card,
    borderBottomRightRadius: radius.card,
    paddingBottom: space.sm,
  },
  taskIndent: {
    paddingLeft: 24,
  },
  emptyContainer: {
    marginTop: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: space.xs,
  },
  emptyIconBox: {
    width: 64,
    height: 64,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  emptyTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emptySubtitle: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 260,
  },
  subtaskActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingLeft: 48,
    paddingBottom: 8,
  },
  subtaskAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  subtaskActionText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
    paddingHorizontal: space.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radius.sheet,
    backgroundColor: colors.surfaceRaised,
    padding: space.xl,
    gap: space.md,
    ...shadow.floating,
  },
  modalCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalCardTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  modalInput: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: 17,
    color: colors.textPrimary,
  },
});
