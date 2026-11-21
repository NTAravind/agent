import type { Routine, RoutinePatch, RoutineRun, RoutineWithPreview } from '@agent/shared';

import { authedFetch } from '@/lib/api-session';

/**
 * Routines client (Phase 10).
 *
 * A routine is a scheduled prompt bound to an agent and a chat. The app
 * never sends dates: the server owns the schedule and computes the next
 * occurrences.
 */

/** The user's routines, newest first, with the schedule preview. */
export async function fetchRoutines(): Promise<RoutineWithPreview[]> {
  const response = await authedFetch<{ routines: RoutineWithPreview[] }>('/api/routines');
  return response.routines;
}

/** Confirms a proposed routine — nothing recurring runs before this. */
export async function activateRoutine(id: string): Promise<RoutineWithPreview> {
  const response = await authedFetch<{ routine: RoutineWithPreview }>(`/api/routines/${id}/activate`, {
    method: 'POST',
  });
  return response.routine;
}

/** Pauses a routine (it keeps its schedule, it just stops firing). */
export async function pauseRoutine(id: string): Promise<Routine> {
  const response = await authedFetch<{ routine: Routine }>(`/api/routines/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'paused' }),
  });
  return response.routine;
}

/** Resumes a paused routine and schedules its next occurrence. */
export async function resumeRoutine(id: string): Promise<RoutineWithPreview> {
  const response = await authedFetch<{ routine: RoutineWithPreview }>(`/api/routines/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'active' }),
  });
  return response.routine;
}

export async function updateRoutine(id: string, patch: RoutinePatch): Promise<RoutineWithPreview> {
  const response = await authedFetch<{ routine: RoutineWithPreview }>(`/api/routines/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return response.routine;
}

export async function deleteRoutine(id: string): Promise<void> {
  await authedFetch<{ deleted: boolean }>(`/api/routines/${id}`, { method: 'DELETE' });
}

/** Runs the routine right now (the schedule is left untouched). */
export async function runRoutineNow(id: string): Promise<{ runId: string | null }> {
  const response = await authedFetch<{ runId: string | null }>(`/api/routines/${id}/run-now`, {
    method: 'POST',
  });
  return response;
}

/** The runs this routine has produced (newest first). */
export async function fetchRoutineRuns(id: string): Promise<RoutineRun[]> {
  const response = await authedFetch<{ runs: RoutineRun[] }>(`/api/routines/${id}/runs`);
  return response.runs;
}
