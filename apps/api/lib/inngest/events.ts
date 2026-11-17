import { eventType, staticSchema } from "inngest";

/**
 * Event types for the whole app (API_SPEC.md section 7).
 * Inngest v4 defines event types per event instead of a central schema map.
 */

export type AgentRunRequested = {
  runId: string;
  userId: string;
  agentId?: string;
  goal: string;
  threadId?: string;
  preferredModel?: string;
};

export type ApprovalDecided = {
  approvalId: string;
  runId: string;
  userId: string;
  decision: "approve" | "deny";
};

export type ChatCompleted = {
  threadId: string;
  userId: string;
  messageId: string;
};

export type VaultChanged = {
  userId: string;
  ref?: string;
};

export type DocumentUploaded = {
  documentId: string;
  userId: string;
};

export type CanvasRefreshRequested = {
  canvasId: string;
  userId: string;
};

export type MonitorTick = {
  userId: string;
};

export const agentRunRequested = eventType("agent/run.requested", {
  schema: staticSchema<AgentRunRequested>(),
});

export const approvalDecided = eventType("approval/decided", {
  schema: staticSchema<ApprovalDecided>(),
});

export const chatCompleted = eventType("chat/completed", {
  schema: staticSchema<ChatCompleted>(),
});

export const vaultChanged = eventType("vault/changed", {
  schema: staticSchema<VaultChanged>(),
});

export const documentUploaded = eventType("document/uploaded", {
  schema: staticSchema<DocumentUploaded>(),
});

export const canvasRefreshRequested = eventType("canvas/refresh.requested", {
  schema: staticSchema<CanvasRefreshRequested>(),
});

export const monitorTick = eventType("monitor/tick", {
  schema: staticSchema<MonitorTick>(),
});
