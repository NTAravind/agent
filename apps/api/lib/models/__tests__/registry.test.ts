import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MODEL_REGISTRY } from "../registry";
import { ModelRegistryEntrySchema, MODEL_CAPABILITIES } from "@agent/shared";

describe("model registry", () => {
  it("every entry matches the shared registry schema", () => {
    for (const entry of MODEL_REGISTRY) {
      const parsed = ModelRegistryEntrySchema.safeParse(entry);
      assert.ok(parsed.success, `${entry.id} failed validation: ${JSON.stringify(parsed.error?.issues)}`);
    }
  });

  it("has unique ids and unique provider model ids", () => {
    const ids = MODEL_REGISTRY.map((entry) => entry.id);
    const providerIds = MODEL_REGISTRY.map((entry) => `${entry.provider}:${entry.providerModelId}`);
    assert.equal(new Set(ids).size, ids.length, "duplicate registry id");
    assert.equal(new Set(providerIds).size, providerIds.length, "duplicate provider model id");
  });

  it("uses the provider prefix as the id prefix", () => {
    for (const entry of MODEL_REGISTRY) {
      assert.ok(entry.id.startsWith(`${entry.provider}:`), `${entry.id} does not start with ${entry.provider}:`);
    }
  });

  it("declares every capability flag explicitly", () => {
    for (const entry of MODEL_REGISTRY) {
      for (const capability of MODEL_CAPABILITIES) {
        assert.equal(
          typeof entry.capabilities[capability],
          "boolean",
          `${entry.id} is missing capability ${capability}`,
        );
      }
    }
  });

  it("only marks Google models as private_ok", () => {
    for (const entry of MODEL_REGISTRY) {
      assert.equal(
        entry.privateOk,
        entry.provider === "google",
        `${entry.id} has an unexpected privateOk value`,
      );
    }
  });
});
