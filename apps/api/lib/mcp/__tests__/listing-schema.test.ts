import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MCPServerCreateSchema, MCPServerPatchSchema } from "@agent/shared";

describe("MCPServerCreateSchema", () => {
  it("accepts a minimal listing", () => {
    const parsed = MCPServerCreateSchema.safeParse({
      slug: "acme-docs",
      name: "Acme Docs",
      authType: "none",
    });
    assert.equal(parsed.success, true);
  });

  it("requires slug, name and authType", () => {
    for (const body of [
      { name: "Acme", authType: "none" },
      { slug: "acme", authType: "none" },
      { slug: "acme", name: "Acme" },
    ]) {
      assert.equal(MCPServerCreateSchema.safeParse(body).success, false, JSON.stringify(body));
    }
  });

  it("rejects slugs that are not normalized", () => {
    for (const slug of ["Acme Docs", "acme docs", "-acme", "acme!", "a"]) {
      const parsed = MCPServerCreateSchema.safeParse({ slug, name: "Acme", authType: "none" });
      assert.equal(parsed.success, false, slug);
    }
  });

  it("caps setup instructions at 4000 characters", () => {
    const base = { slug: "acme", name: "Acme", authType: "api_key" as const };
    assert.equal(
      MCPServerCreateSchema.safeParse({ ...base, instructions: "x".repeat(4000) }).success,
      true,
    );
    assert.equal(
      MCPServerCreateSchema.safeParse({ ...base, instructions: "x".repeat(4001) }).success,
      false,
    );
  });

  it("accepts a null endpoint (stdio) and rejects a malformed one", () => {
    const base = { slug: "acme", name: "Acme", authType: "none" as const };
    assert.equal(MCPServerCreateSchema.safeParse({ ...base, endpoint: null }).success, true);
    assert.equal(MCPServerCreateSchema.safeParse({ ...base, endpoint: "not a url" }).success, false);
  });

  it("rejects unknown auth types and providers", () => {
    assert.equal(
      MCPServerCreateSchema.safeParse({ slug: "acme", name: "Acme", authType: "magic" }).success,
      false,
    );
    assert.equal(
      MCPServerCreateSchema.safeParse({
        slug: "acme",
        name: "Acme",
        authType: "none",
        provider: "sketchy",
      }).success,
      false,
    );
  });
});

describe("MCPServerPatchSchema", () => {
  it("accepts a partial patch", () => {
    assert.equal(MCPServerPatchSchema.safeParse({ enabled: false }).success, true);
    assert.equal(MCPServerPatchSchema.safeParse({ name: "Renamed" }).success, true);
  });

  it("accepts clearing nullable fields", () => {
    assert.equal(MCPServerPatchSchema.safeParse({ endpoint: null }).success, true);
    assert.equal(MCPServerPatchSchema.safeParse({ iconUrl: null }).success, true);
  });

  it("still validates fields that are present", () => {
    assert.equal(MCPServerPatchSchema.safeParse({ authType: "magic" }).success, false);
    assert.equal(MCPServerPatchSchema.safeParse({ slug: "Not Normalized" }).success, false);
    assert.equal(MCPServerPatchSchema.safeParse({ instructions: "x".repeat(4001) }).success, false);
  });
});
