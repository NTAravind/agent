import type {
  CalendarEvent,
  CalendarEventCreate,
  CalendarEventPatch,
  Task,
  TaskCreate,
  TaskList,
  TaskListCreate,
  TaskPatch,
} from '@agent/shared';

import { authedFetch } from '@/lib/api-session';

/* ------------------------------------------------------------------ lists */

export async function fetchTaskLists(): Promise<TaskList[]> {
  const response = await authedFetch<{ taskLists: TaskList[] }>('/api/task-lists');
  return response.taskLists;
}

export async function createTaskList(input: TaskListCreate): Promise<TaskList> {
  const response = await authedFetch<{ taskList: TaskList }>('/api/task-lists', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.taskList;
}

export async function renameTaskList(id: string, name: string): Promise<TaskList> {
  const response = await authedFetch<{ taskList: TaskList }>(`/api/task-lists/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  return response.taskList;
}

/* ------------------------------------------------------------------ tasks */

export async function fetchTasks(params?: {
  listId?: string;
  status?: 'open' | 'done' | 'cancelled';
  from?: string;
  to?: string;
}): Promise<Task[]> {
  const query = new URLSearchParams();
  if (params?.listId) query.set('listId', params.listId);
  if (params?.status) query.set('status', params.status);
  if (params?.from) query.set('from', params.from);
  if (params?.to) query.set('to', params.to);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await authedFetch<{ tasks: Task[] }>(`/api/tasks${suffix}`);
  return response.tasks;
}

export async function createTask(input: TaskCreate): Promise<Task> {
  const response = await authedFetch<{ task: Task }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.task;
}

export async function updateTask(id: string, patch: TaskPatch): Promise<Task> {
  const response = await authedFetch<{ task: Task }>(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return response.task;
}

export async function completeTask(id: string): Promise<Task> {
  return updateTask(id, { status: 'done' });
}

export async function deleteTask(id: string): Promise<void> {
  await authedFetch<{ deleted: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' });
}

/* ----------------------------------------------------------------- events */

export async function fetchEvents(from?: string, to?: string): Promise<CalendarEvent[]> {
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await authedFetch<{ events: CalendarEvent[] }>(`/api/events${suffix}`);
  return response.events;
}

export async function createEvent(input: CalendarEventCreate): Promise<CalendarEvent> {
  const response = await authedFetch<{ event: CalendarEvent }>('/api/events', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.event;
}

export async function updateEvent(id: string, patch: CalendarEventPatch): Promise<CalendarEvent> {
  const response = await authedFetch<{ event: CalendarEvent }>(`/api/events/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return response.event;
}

export async function deleteEvent(id: string): Promise<void> {
  await authedFetch<{ deleted: boolean }>(`/api/events/${id}`, { method: 'DELETE' });
}

/* ------------------------------------------------------------ push tokens */

export async function registerPushToken(
  expoToken: string,
  platform: 'ios' | 'android'
): Promise<void> {
  await authedFetch<{ ok: boolean }>('/api/push-tokens', {
    method: 'POST',
    body: JSON.stringify({ expoToken, platform }),
  });
}
