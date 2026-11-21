import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Spinner, Typography } from 'heroui-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FolderPlus, ListTodo, Plus, Trash2, X } from 'lucide-react-native';
import type { Task, TaskList } from '@agent/shared';

import { AppHeader } from '@/components/app-header';
import { TaskRow } from '@/components/task-row';
import { fetchTaskLists, fetchTasks, createTask, createTaskList, deleteTask, updateTask } from '@/lib/productivity';

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
    () => (activeListId ? tasks.filter((task) => task.listId === activeListId) : tasks),
    [tasks, activeListId],
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
      setTasks((current) =>
        current.map((item) =>
          item.id === task.id
            ? { ...item, status: task.status === 'done' ? 'open' : 'done' }
            : item,
        ),
      );
      try {
        await updateTask(task.id, { status: task.status === 'done' ? 'open' : 'done' });
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
        void load();
      }
    },
    [load],
  );

  const handleAdd = useCallback(async () => {
    const title = draftTitle.trim();
    if (!title || saving) return;
    setSaving(true);
    try {
      let listId = activeListId ?? lists[0]?.id;
      if (!listId) {
        const created = await createTaskList({ name: 'Inbox' });
        setLists((current) => [...current, created]);
        listId = created.id;
      }
      const task = await createTask({
        listId,
        title,
        ...(draftParentId ? { parentId: draftParentId } : {}),
      });
      setTasks((current) => [task, ...current]);
      setDraftTitle('');
      setDraftParentId(null);
      setComposerOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [activeListId, draftParentId, draftTitle, lists, saving]);

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
                setNotice(error instanceof Error ? error.message : String(error)),
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
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [draftListName]);

  const renderTask = (task: Task, depth = 0) => {
    const children = childrenOf(task.id);
    return (
      <View key={task.id}>
        <View
          className={
            depth > 0 ? 'border-t border-zinc-100 dark:border-white/5 pl-6' : undefined
          }
        >
          <TaskRow
            task={task}
            onToggle={(t) => void handleToggle(t)}
            listName={depth === 0 ? undefined : undefined}
          />
        </View>
        <View className="flex-row items-center gap-3 pl-12 -mt-1 pb-1">
          <Pressable
            onPress={() => {
              setDraftParentId(task.id);
              setComposerOpen(true);
            }}
            className="flex-row items-center gap-1 active:opacity-60"
          >
            <Plus size={12} color="#71717a" />
            <Text className="text-[11px] text-zinc-500">Subtask</Text>
          </Pressable>
          <Pressable onPress={() => handleDelete(task)} className="active:opacity-60">
            <Trash2 size={12} color="#ef4444" />
          </Pressable>
        </View>
        {children.map((child) => renderTask(child, depth + 1))}
      </View>
    );
  };

  return (
    <View className="flex-1 bg-white dark:bg-[#09090b]">
      <AppHeader
        left={
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            className="px-2 py-1 active:opacity-60"
          >
            <Typography type="body" className="text-zinc-500 dark:text-zinc-400">
              Back
            </Typography>
          </Pressable>
        }
        center={
          <Typography type="body-sm" weight="semibold" className="text-zinc-900 dark:text-white">
            Tasks
          </Typography>
        }
        right={
          <Pressable
            onPress={() => {
              setDraftParentId(null);
              setComposerOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="New task"
            className="h-8.5 w-8.5 items-center justify-center rounded-full border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 active:opacity-75"
          >
            <Plus size={15} color="#71717a" />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor="#8b5cf6"
          />
        }
      >
        {/* List chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row items-center gap-2 pr-2">
            {lists.map((list) => {
              const active = list.id === activeListId;
              return (
                <Pressable
                  key={list.id}
                  onPress={() => setActiveListId(list.id)}
                  className={`rounded-full px-3.5 py-1.5 border ${
                    active
                      ? 'bg-zinc-900 dark:bg-white border-zinc-900 dark:border-white'
                      : 'border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5'
                  }`}
                >
                  <Text
                    className={`text-xs font-semibold ${
                      active ? 'text-white dark:text-zinc-900' : 'text-zinc-600 dark:text-zinc-400'
                    }`}
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
              className="flex-row items-center gap-1 rounded-full border border-dashed border-zinc-300 dark:border-white/20 px-3 py-1.5 active:opacity-70"
            >
              <FolderPlus size={13} color="#71717a" />
              <Text className="text-xs font-semibold text-zinc-500">List</Text>
            </Pressable>
          </View>
        </ScrollView>

        {notice ? (
          <View className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-3.5 py-2.5">
            <Text className="text-xs text-sky-500 dark:text-sky-400">{notice}</Text>
          </View>
        ) : null}

        {loading ? (
          <View className="py-16 items-center justify-center">
            <Spinner size="lg" color="default" />
          </View>
        ) : roots.length === 0 ? (
          <View className="mt-16 items-center justify-center px-6 gap-3">
            <View className="h-16 w-16 items-center justify-center rounded-3xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5">
              <ListTodo size={28} color="#71717a" />
            </View>
            <Text className="text-base font-semibold text-zinc-900 dark:text-white">No tasks yet</Text>
            <Text className="text-xs text-zinc-500 text-center max-w-xs">
              Tap + to add your first task, or ask an agent to create one for you.
            </Text>
          </View>
        ) : (
          <View className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#121215] overflow-hidden">
            {roots.map((task, index) => (
              <View key={task.id} className={index > 0 ? 'border-t border-zinc-100 dark:border-white/5' : ''}>
                {renderTask(task)}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Composer */}
      <Modal visible={composerOpen} transparent animationType="fade" onRequestClose={() => setComposerOpen(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-md rounded-3xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#121215] p-5 gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-zinc-900 dark:text-white">
                {draftParentId ? 'New subtask' : 'New task'}
              </Text>
              <Pressable onPress={() => setComposerOpen(false)} accessibilityRole="button">
                <X size={18} color="#71717a" />
              </Pressable>
            </View>
            <TextInput
              autoFocus
              className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3.5 py-3 text-sm text-zinc-900 dark:text-white"
              placeholder="What needs doing?"
              placeholderTextColor="#71717a"
              value={draftTitle}
              onChangeText={setDraftTitle}
              onSubmitEditing={() => void handleAdd()}
              returnKeyType="done"
            />
            <Pressable
              onPress={() => void handleAdd()}
              disabled={saving || !draftTitle.trim()}
              className="rounded-2xl bg-zinc-900 dark:bg-white py-3 items-center active:opacity-80 disabled:opacity-40"
            >
              {saving ? (
                <Spinner size="sm" color="default" />
              ) : (
                <Text className="text-sm font-bold text-white dark:text-zinc-900">Add task</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* New list */}
      <Modal visible={listModalOpen} transparent animationType="fade" onRequestClose={() => setListModalOpen(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full max-w-md rounded-3xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#121215] p-5 gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-bold text-zinc-900 dark:text-white">New list</Text>
              <Pressable onPress={() => setListModalOpen(false)} accessibilityRole="button">
                <X size={18} color="#71717a" />
              </Pressable>
            </View>
            <TextInput
              autoFocus
              className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3.5 py-3 text-sm text-zinc-900 dark:text-white"
              placeholder="List name"
              placeholderTextColor="#71717a"
              value={draftListName}
              onChangeText={setDraftListName}
              onSubmitEditing={() => void handleSaveList()}
              returnKeyType="done"
            />
            <Pressable
              onPress={() => void handleSaveList()}
              disabled={saving || !draftListName.trim()}
              className="rounded-2xl bg-zinc-900 dark:bg-white py-3 items-center active:opacity-80 disabled:opacity-40"
            >
              {saving ? (
                <Spinner size="sm" color="default" />
              ) : (
                <Text className="text-sm font-bold text-white dark:text-zinc-900">Create list</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
