import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import { CapabilityError, ModelRegistryError } from "../errors";
import { findRegistryEntry } from "../registry";
import {
  __resetProviderInstancesForTests,
  __setModelFactoryForTests,
  getModel,
  isProviderConfigured,
  providersWithKeys,
  resolveModel,
} from "../resolver";

const fakeModel = { modelId: "fake", specificationVersion: "v4" } as never;

const ENV_KEYS = [
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "MISTRAL_API_KEY",
  "DEEPSEEK_API_KEY",
  "HUGGINGFACE_API_KEY",
  "COHERE_API_KEY",
] as const;

describe("resolver", () => {
  const originalKeys: Record<(typeof ENV_KEYS)[number], string | undefined> = Object.fromEntries(
    ENV_KEYS.map((name) => [name, process.env[name]]),
  ) as Record<(typeof ENV_KEYS)[number], string | undefined>;

  beforeEach(() => {
    __resetProviderInstancesForTests();
  });

  afterEach(() => {
    // Assigning undefined to process.env coerces to the string "undefined",
    // which would read as a configured key — delete instead.
    for (const name of ENV_KEYS) {
      const original = originalKeys[name];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
    __resetProviderInstancesForTests();
    __setModelFactoryForTests(null);
  });

  it("throws a typed error for an unknown model id", () => {
    assert.throws(
      () => getModel("google:does-not-exist"),
      (error: unknown) => {
        assert.ok(error instanceof ModelRegistryError);
        assert.equal(error.code, "unknown_model");
        return true;
      },
    );
  });

  it("throws a typed error when the provider has no API key", () => {
    delete process.env.GROQ_API_KEY;
    __resetProviderInstancesForTests();

    assert.throws(
      () => getModel("groq:gpt-oss-120b"),
      (error: unknown) => {
        assert.ok(error instanceof ModelRegistryError);
        assert.equal(error.code, "provider_not_configured");
        return true;
      },
    );
  });

  it("resolves a configured provider to a language model", () => {
    process.env.GROQ_API_KEY = "test-key";
    __resetProviderInstancesForTests();

    const model = getModel("groq:gpt-oss-120b");
    assert.ok(model, "expected a model instance");
    assert.equal((model as { modelId: string }).modelId, "openai/gpt-oss-120b");
  });

  it("returns the registry entry alongside the model", () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
    __resetProviderInstancesForTests();

    const { entry, model } = resolveModel("google:gemini-3.8-flash");
    assert.equal(entry.id, "google:gemini-3.8-flash");
    assert.ok(model);
  });

  it("reports which providers have keys configured", () => {
    for (const name of ENV_KEYS) delete process.env[name];
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
    __resetProviderInstancesForTests();

    assert.equal(isProviderConfigured("google"), true);
    assert.equal(isProviderConfigured("groq"), false);
    assert.equal(isProviderConfigured("mistral"), false);
    assert.deepEqual(providersWithKeys(), ["google"]);
  });

  it("can be swapped for a fake model factory (test hook)", () => {
    // The restored factory builds a real provider model, so the key must be set.
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
    __resetProviderInstancesForTests();

    const restore = __setModelFactoryForTests(() => fakeModel);
    assert.equal(getModel("google:gemini-3.8-flash"), fakeModel);
    restore();
    assert.notEqual(getModel("google:gemini-3.8-flash"), fakeModel);
  });

  it("keeps registry entries and resolvers in sync", () => {
    for (const id of [
      "google:gemini-3.8-flash",
      "groq:gpt-oss-120b",
      "openrouter:gemini-3.8-flash",
      "mistral:mistral-large-latest",
      "deepseek:deepseek-chat",
      "huggingface:meta-llama/Llama-3.3-70B-Instruct",
      "cohere:command-a-03-2025",
    ]) {
      assert.ok(findRegistryEntry(id), `${id} is missing from the registry`);
    }
  });
});

describe("capability gate", () => {
  it("rejects a model that lacks a required capability", async () => {
    const { assertCapabilities } = await import("../capability");
    const entry = findRegistryEntry("groq:gpt-oss-120b")!;

    assert.throws(
      () => assertCapabilities(entry, { vision: true }),
      (error: unknown) => {
        assert.ok(error instanceof CapabilityError);
        assert.equal(error.code, "capability_mismatch");
        return true;
      },
    );
  });

  it("accepts a model that has every required capability", async () => {
    const { assertCapabilities } = await import("../capability");
    const entry = findRegistryEntry("google:gemini-3.8-flash")!;

    assert.doesNotThrow(() => assertCapabilities(entry, { vision: true, tools: true }));
  });
});
