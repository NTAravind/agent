import { Annotation } from "@langchain/langgraph";

import type { ToolCallInfo } from "@/lib/agent/tools";

/**
 * Agent graph state (plan → act ⇄ tools → observe).
 *
 * Persisted between nodes by the Postgres checkpointer, keyed by the run id —
 * so an Inngest retry resumes the run from the last completed node, and an
 * approval interrupt parks the run exactly at the tool gate.
 */
export type AgentFinding = {
  step: string;
  summary: string;
  toolCalls: number;
};

export type ObserveAction = "continue" | "revise" | "finish";

export const AgentState = Annotation.Root({
  userId: Annotation<string>,
  runId: Annotation<string>,
  goal: Annotation<string>,

  /** The research steps produced by the plan node. */
  planSteps: Annotation<string[]>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => [],
  }),
  /** Which plan step the act node executes next. */
  stepIndex: Annotation<number>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => 0,
  }),
  /** Completed act steps (the max-step guard). */
  iterations: Annotation<number>({
    reducer: (prev, next) => Math.max(prev, next ?? 0),
    default: () => 0,
  }),
  findings: Annotation<AgentFinding[]>({
    reducer: (prev, next) => [...prev, ...(next ?? [])],
    default: () => [],
  }),

  /** Tool calls awaiting the gate / execution. */
  pendingCalls: Annotation<ToolCallInfo[]>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => [],
  }),
  /** Transcript of executed tool calls and results (ReAct-style context). */
  toolLog: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...(next ?? [])],
    default: () => [],
  }),
  /** LLM round-trips within the current step (the per-step loop guard). */
  roundsThisStep: Annotation<number>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => 0,
  }),
  /** Approval row the run is currently parked on, if any. */
  awaitingApprovalId: Annotation<string | null>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => null,
  }),

  /** The observe node's decision for what happens next. */
  nextAction: Annotation<ObserveAction | null>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => null,
  }),
  /** Why the previous act failed / what to do differently (self-correction). */
  revisionNote: Annotation<string | null>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => null,
  }),
  failed: Annotation<boolean>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => false,
  }),
  done: Annotation<boolean>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => false,
  }),
  result: Annotation<string | null>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => null,
  }),
  /** Model that wrote the final report (for agent_runs.model). */
  finalModel: Annotation<string | null>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => null,
  }),
});

export type AgentStateType = typeof AgentState.State;

/** Hard cap on completed act steps — the run must always finish. */
export const MAX_AGENT_STEPS = 10;
/** Hard cap on LLM/tool round-trips within one step. */
export const MAX_TOOL_ROUNDS_PER_STEP = 6;
