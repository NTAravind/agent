import { z } from "zod";

/** Agent runs and their timeline events — mirrors db/migrations/0005_agent_runs.sql. */

export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "cancelled",
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

export const AgentRunSchema = z.object({
  id: z.string().uuid(),
  goal: z.string(),
  status: RunStatusSchema,
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  model: z.string().nullable(),
  tokens_used: z.number(),
  thread_id: z.string().uuid().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});

export type AgentRun = z.infer<typeof AgentRunSchema>;

export const RunEventTypeSchema = z.enum([
  "node_start",
  "node_end",
  "tool_call",
  "tool_result",
  "message",
  "error",
]);

export type RunEventType = z.infer<typeof RunEventTypeSchema>;

export const RunEventSchema = z.object({
  id: z.number(),
  run_id: z.string().uuid(),
  type: RunEventTypeSchema,
  payload: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});

export type RunEvent = z.infer<typeof RunEventSchema>;

export const StartRunResponseSchema = z.object({
  runId: z.string().uuid(),
  status: RunStatusSchema,
});

export type StartRunResponse = z.infer<typeof StartRunResponseSchema>;

export const ApprovalStatusSchema = z.enum(["pending", "approved", "denied", "expired"]);

export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  tool_name: z.string().nullable(),
  args: z.unknown().nullable(),
  reason: z.string().nullable(),
  status: ApprovalStatusSchema,
  created_at: z.string(),
  expires_at: z.string().nullable(),
});

export type Approval = z.infer<typeof ApprovalSchema>;
