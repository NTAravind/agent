import { z } from "zod";

/** Agent entity + runs and their timeline events. */

// --- Agent -----------------------------------------------------------------

/**
 * Avatar as stored in `agents.avatar` (jsonb). `image` value is a Storage
 * path; API responses add a response-only signed read `url` for image
 * avatars (never persisted — routes strip it on write). Renderers fall back
 * to the default emoji when an image fails to load.
 */
export const AgentAvatarSchema = z.object({
  type: z.enum(["emoji", "icon", "image"]),
  value: z.string().min(1).max(512),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "use a #rrggbb color")
    .optional(),
  /** Signed Storage read URL (image avatars, API responses only). */
  url: z.string().max(2048).optional(),
});
export type AgentAvatar = z.infer<typeof AgentAvatarSchema>;

/** Matches the `agents.avatar` column default. */
export const DEFAULT_AGENT_AVATAR: AgentAvatar = {
  type: "emoji",
  value: "🤖",
  color: "#7F9DFF",
};

const agentNameSchema = z.string().min(1).max(60);
const registryModelIdSchema = z.string().min(3).max(120);

/**
 * POST /api/agents body. `instructions` maps to the `system_prompt` column,
 * `fallbackModels` to `fallback_models`. `model: null` means "app default"
 * (the dashboard-configured default model).
 */
export const AgentCreateSchema = z.object({
  name: agentNameSchema,
  role: z.string().max(120).nullish(),
  instructions: z.string().max(4000).nullish(),
  model: registryModelIdSchema.nullish(),
  fallbackModels: z.array(registryModelIdSchema).max(5).optional(),
  avatar: AgentAvatarSchema.optional(),
  isSupervisor: z.boolean().optional(),
});
export type AgentCreate = z.infer<typeof AgentCreateSchema>;

/** PATCH /api/agents/:id body — every field optional; `null` clears. */
export const AgentPatchSchema = AgentCreateSchema.partial();
export type AgentPatch = z.infer<typeof AgentPatchSchema>;

/** Agent as API responses return it (camelCase, avatar as an object). */
export const AgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: z.string().nullable(),
  instructions: z.string().nullable(),
  model: z.string().nullable(),
  fallbackModels: z.array(z.string()),
  avatar: AgentAvatarSchema,
  isSupervisor: z.boolean(),
  /** Sleep state: asleep agents have all active runs paused and reject new tasks. */
  isSleeping: z.boolean(),
  /** Enabled MCP tools the agent can currently call. */
  toolCount: z.number().int().nonnegative(),
  /**
   * The agent's primary (persistent) chat thread. Agents are chats: opening
   * the agent resumes this thread.
   */
  primaryThreadId: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
});
export type Agent = z.infer<typeof AgentSchema>;

/** Compact agent reference embedded in threads, runs and approvals. */
export const AgentSummarySchema = z.object({
  name: z.string(),
  avatar: AgentAvatarSchema,
});
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

// --- Runs ------------------------------------------------------------------

/** Agent runs and their timeline events — mirrors db/migrations/0005_agent_runs.sql. */

export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "awaiting_approval",
  "paused",
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
