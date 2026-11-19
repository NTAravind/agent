import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { normalizeBriefs, pickCrossProviderModel, type Specialist } from "../supervisor";

const specialists: Specialist[] = [
  { id: "a", name: "Researcher", role: "facts" },
  { id: "b", name: "Critic", role: "gaps" },
  { id: "c", name: "Writer", role: "prose" },
];

describe("supervisor delegation", () => {
  it("keeps valid distinct briefs in the model's order", () => {
    const briefs = normalizeBriefs(
      [
        { agentId: "b", task: "Find the gaps" },
        { agentId: "a", task: "Gather the facts" },
      ],
      specialists,
      "goal",
    );
    assert.deepEqual(
      briefs.map((brief) => brief.agentId),
      ["b", "a"],
    );
    assert.equal(briefs[0].task, "Find the gaps");
  });

  it("drops unknown ids and duplicate assignments", () => {
    const briefs = normalizeBriefs(
      [
        { agentId: "nope", task: "not a specialist" },
        { agentId: "a", task: "first" },
        { agentId: "a", task: "duplicate" },
      ],
      specialists,
      "goal",
    );
    // "a" survives once; padding fills the second seat with "b".
    assert.deepEqual(
      briefs.map((brief) => brief.agentId),
      ["a", "b"],
    );
    assert.equal(briefs[0].task, "first");
  });

  it("always delegates to at least 2 specialists", () => {
    const briefs = normalizeBriefs([{ agentId: "a", task: "only one" }], specialists, "my goal");
    assert.equal(briefs.length, 2);
    assert.notEqual(briefs[0].agentId, briefs[1].agentId);
    // The padded brief carries the goal so the specialist isn't flying blind.
    assert.match(briefs[1].task, /my goal/);
  });

  it("ignores empty tasks", () => {
    const briefs = normalizeBriefs(
      [
        { agentId: "a", task: "   " },
        { agentId: "b", task: "real task" },
      ],
      specialists,
      "goal",
    );
    assert.deepEqual(
      briefs.map((brief) => brief.agentId),
      ["b", "a"],
    );
    assert.equal(briefs[0].task, "real task");
  });

  it("caps the fan-out at 4 briefs", () => {
    const pool: Specialist[] = Array.from({ length: 6 }, (_, index) => ({
      id: `s${index}`,
      name: `Specialist ${index}`,
      role: null,
    }));
    const briefs = normalizeBriefs(
      pool.map((specialist) => ({ agentId: specialist.id, task: `task ${specialist.id}` })),
      pool,
      "goal",
    );
    assert.equal(briefs.length, 4);
  });
});

describe("cross-provider verifier", () => {
  const saved: Record<string, string | undefined> = {};

  before(() => {
    // providersWithKeys reads process.env at call time; give every provider a
    // key so the cross-provider pick is exercised deterministically.
    for (const name of [
      "GOOGLE_GENERATIVE_AI_API_KEY",
      "GROQ_API_KEY",
      "OPENROUTER_API_KEY",
      "MISTRAL_API_KEY",
      "DEEPSEEK_API_KEY",
      "HUGGINGFACE_API_KEY",
      "COHERE_API_KEY",
    ]) {
      saved[name] = process.env[name];
      process.env[name] = "test-key";
    }
  });

  after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("never picks a worker's provider", () => {
    const model = pickCrossProviderModel(new Set(["google"]));
    assert.ok(model, "expected a cross-provider model when all keys exist");
    assert.ok(!model.startsWith("google:"), `${model} is a worker provider`);
    assert.ok(model.startsWith("groq:") || model.startsWith("openrouter:"), model);
  });

  it("picks a model when the worker set is empty", () => {
    const model = pickCrossProviderModel(new Set());
    assert.ok(model, "expected a verifier model when no worker provider is known");
  });

  it("stays within the remaining keyed providers", () => {
    const model = pickCrossProviderModel(new Set(["google", "groq"]));
    assert.ok(model, "openrouter key is available");
    assert.ok(model?.startsWith("openrouter:"), model);
  });
});
