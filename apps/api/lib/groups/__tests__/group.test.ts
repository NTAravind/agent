import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compactGroupSummary,
  detectPingPong,
  evaluateGroupGuardrails,
  nextRoundtableMember,
  selectMentionedAgent,
  type GroupTurn,
} from "@/lib/agent/group";
import {
  buildHandoffBrief,
  filterPrivateTools,
  handoffAllowedForPrivacy,
  isPrivateSafeBrief,
  privateModelChain,
} from "@/lib/groups/privacy";
import {
  buildConsultPrompt,
  evaluateAskDepth,
  resolveGroupMember,
} from "@/lib/groups/tools";
import { toolsForStep } from "@/lib/agent/graph";

const members = [
  { id: "agent-a", name: "Researcher", model: null },
  { id: "agent-b", name: "Reviewer", model: null },
];

describe("group membership", () => {
  it("resolves a member by id or case-insensitive name", () => {
    assert.equal(resolveGroupMember("agent-a", members)?.id, "agent-a");
    assert.equal(resolveGroupMember("reviewer", members)?.id, "agent-b");
    assert.equal(resolveGroupMember("Reviewer", members)?.id, "agent-b");
  });

  it("never resolves an agent outside the group", () => {
    assert.equal(resolveGroupMember("outsider", members), null);
  });

  it("routes an @mention only to a group member", () => {
    assert.equal(selectMentionedAgent("@Researcher please check", members), "agent-a");
    assert.equal(selectMentionedAgent("@unknown please check", members), null);
  });

  it("matches a complete multi-word member name", () => {
    const named = [
      { id: "lead", name: "Research Lead" },
      { id: "reviewer", name: "Reviewer" },
    ];
    assert.equal(selectMentionedAgent("@research lead please check", named), "lead");
    assert.equal(selectMentionedAgent("@Reviewer please check", named), "reviewer");
  });

  it("accepts a member UUID as a mention", () => {
    assert.equal(selectMentionedAgent("@agent-b please check", members), "agent-b");
  });
});

describe("group routing guardrails", () => {
  it("detects the A to B to A to B ping-pong pattern", () => {
    assert.equal(detectPingPong(["a", "b", "a", "b"]), true);
    assert.equal(detectPingPong(["a", "b", "a"]), false);
    assert.equal(detectPingPong(["a", "b", "c", "d"]), false);
  });

  it("stops before the hop limit is exceeded", () => {
    const result = evaluateGroupGuardrails({
      hops: 8,
      maxHops: 8,
      tokensUsed: 0,
      tokenBudget: 10_000,
      prospectiveSequence: ["a", "b"],
    });
    assert.deepEqual(result, { stop: true, reason: "max_hops" });
  });

  it("stops when the cumulative token budget is exhausted", () => {
    const result = evaluateGroupGuardrails({
      hops: 1,
      maxHops: 8,
      tokensUsed: 10_000,
      tokenBudget: 10_000,
      prospectiveSequence: ["a", "b"],
    });
    assert.deepEqual(result, { stop: true, reason: "token_budget" });
  });

  it("stops before running the fourth turn of a ping-pong", () => {
    const result = evaluateGroupGuardrails({
      hops: 3,
      maxHops: 8,
      tokensUsed: 10,
      tokenBudget: 10_000,
      prospectiveSequence: ["a", "b", "a", "b"],
    });
    assert.deepEqual(result, { stop: true, reason: "ping_pong" });
  });

  it("limits nested consults to the configured depth", () => {
    assert.equal(evaluateAskDepth(0, 1), true);
    assert.equal(evaluateAskDepth(1, 1), false);
    assert.equal(evaluateAskDepth(2, 3), true);
  });

  it("makes the nested-ask depth reachable from a member turn", () => {
    // A member turn runs at depth 0 and may consult once; the consulted
    // member runs at depth 1 and may consult once more. A third layer is
    // refused, so the guard is reachable rather than dead code.
    assert.equal(evaluateAskDepth(0, 2), true);
    assert.equal(evaluateAskDepth(1, 2), true);
    assert.equal(evaluateAskDepth(2, 2), false);
  });

  it("moves through a roundtable one member at a time", () => {
    const all = [
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ];
    assert.equal(nextRoundtableMember(all, []), "a");
    assert.equal(nextRoundtableMember(all, ["a"]), "b");
    assert.equal(nextRoundtableMember(all, ["a", "b"]), "c");
  });
});

describe("group privacy", () => {
  it("strips prior private-derived context for a non-private target", () => {
    const brief = buildHandoffBrief(
      {
        task: "Write the release note",
        context: "note-marker: launch checklist",
        summary: "memory-marker: the customer dislikes launch dates",
      },
      false,
    );
    assert.deepEqual(brief, { task: "Write the release note" });
    assert.equal(isPrivateSafeBrief(brief), true);
    assert.doesNotMatch(JSON.stringify(brief), /note-marker|memory-marker/);
  });

  it("keeps context for a private-ok target", () => {
    const brief = buildHandoffBrief(
      {
        task: "Write the release note",
        context: "launch checklist",
        summary: "customer preference",
      },
      true,
    );
    assert.equal(brief.context, "launch checklist");
    assert.equal(brief.summary, "customer preference");
  });

  it("removes note and memory tools from a non-private target", () => {
    const names = ["search_notes", "read_note", "recall_memory", "list_memories", "search_web"];
    assert.deepEqual(filterPrivateTools(names, false), ["search_web"]);
    assert.deepEqual(filterPrivateTools(names, true), names);
  });

  it("does not leak a caller's prior context to a non-private consult target", () => {
    const prompt = buildConsultPrompt({
      targetName: "Reviewer",
      callerBrief: "note-marker: private caller task",
      question: "Check the public summary",
      summary: "memory-marker: private rolling summary",
      privateOk: false,
    });
    assert.match(prompt, /Check the public summary/);
    assert.doesNotMatch(prompt, /note-marker|memory-marker|private caller task/);
  });

  it("keeps a private fallback chain inside private-ok providers", () => {
    const chain = privateModelChain("google:gemini-custom");
    assert.ok(chain.length > 0);
    assert.ok(chain.every((id) => id.startsWith("google:")));
    assert.equal(chain[0], "google:gemini-custom");
  });

  it("blocks a private-capable caller from handing work to a non-private target", () => {
    // The model could copy a private fact into its `task`, so the boundary is
    // the caller's policy — not the prose it wrote.
    assert.equal(handoffAllowedForPrivacy(true, false), false);
    assert.equal(handoffAllowedForPrivacy(true, true), true);
    // A caller that never sees private material may hand off anywhere.
    assert.equal(handoffAllowedForPrivacy(false, false), true);
    assert.equal(handoffAllowedForPrivacy(false, true), true);
  });
});

describe("group tool availability", () => {
  const groupTools = {
    handoff_to: {},
    ask_agent: {},
    post_to_group: {},
    search_notes: {},
    web_search: {},
  } as never;

  it("keeps the group tools in the late rounds", () => {
    const late = toolsForStep(groupTools, 2, 6, null, [
      "handoff_to",
      "ask_agent",
      "post_to_group",
    ]);
    assert.ok(late);
    assert.ok("handoff_to" in late);
    assert.ok("ask_agent" in late);
    assert.ok("post_to_group" in late);
  });

  it("keeps the group tools when a skill narrows the tool set", () => {
    const narrowed = toolsForStep(groupTools, 1, 6, ["web_search"], [
      "handoff_to",
      "ask_agent",
      "post_to_group",
    ]);
    assert.ok(narrowed);
    assert.ok("handoff_to" in narrowed);
    assert.ok("ask_agent" in narrowed);
    assert.ok("post_to_group" in narrowed);
    assert.ok("web_search" in narrowed);
  });

  it("offers no tools on the forced-summary round", () => {
    const final = toolsForStep(groupTools, 6, 6, null, ["handoff_to"]);
    assert.equal(final, undefined);
  });
});

describe("group context compaction", () => {
  it("keeps the rolling summary bounded", () => {
    const turns: GroupTurn[] = [
      {
        runId: "run-1",
        agentId: "a",
        agentName: "Researcher",
        status: "succeeded",
        answer: "x".repeat(3_000),
        tokensUsed: 10,
      },
      {
        runId: "run-2",
        agentId: "b",
        agentName: "Reviewer",
        status: "succeeded",
        answer: "final finding",
        tokensUsed: 10,
      },
    ];
    const summary = compactGroupSummary(turns, 500);
    assert.ok(summary.length <= 600);
    assert.match(summary, /final finding/);
  });
});
