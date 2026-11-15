import { Annotation } from "@langchain/langgraph";

/**
 * Agent graph state (plan → act → observe).
 *
 * Persisted between nodes by the Postgres checkpointer, keyed by the run id —
 * so an Inngest retry resumes the run from the last completed node.
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

  plan: Annotation<string[]>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => [],
  }),
  /** Which plan step the act node executes next. */
  stepIndex: Annotation<number>({
    reducer: (_prev, next) => next ?? _prev,
    default: () => 0,
  }),
  /** Completed act iterations (the max-step guard). */
  iterations: Annotation<number>({
    reducer: (prev, next) => Math.max(prev, next ?? 0),
    default: () => 0,
  }),
  findings: Annotation<AgentFinding[]>({
    reducer: (prev, next) => [...prev, ...(next ?? [])],
    default: () => [],
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
});

export type AgentStateType = typeof AgentState.State;

/** Hard cap on act iterations — the run must always finish. */
export const MAX_AGENT_STEPS = 10;
/** Hard cap on tool round-trips within one act call. */
export const MAX_ACT_ROUNDS = 5;
