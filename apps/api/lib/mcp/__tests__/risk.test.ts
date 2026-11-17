import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyToolRisk,
  MAX_TOOL_DESCRIPTION_CHARS,
  sanitizeDescription,
} from "@/lib/mcp/risk";
import { redactSecrets } from "@/lib/mcp/security/redact-secrets";
import { namespacedToolName } from "@/lib/mcp/tools-loader";

describe("tool risk classification", () => {
  it("trusts destructiveHint → high + approval", () => {
    const result = classifyToolRisk({
      name: "do_thing",
      description: "Does a thing",
      annotations: { destructiveHint: true },
    });
    assert.equal(result.riskLevel, "high");
    assert.equal(result.approvalRequired, true);
  });

  it("classifies destructive verbs as high even with no annotations", () => {
    for (const description of [
      "Delete a page from the workspace",
      "Permanently remove this file and all its versions",
      "Drop the table and all rows",
    ]) {
      const result = classifyToolRisk({ name: "tool", description });
      assert.equal(result.riskLevel, "high", `"${description}" must be high`);
      assert.equal(result.approvalRequired, true);
    }
  });

  it("classifies write verbs as medium", () => {
    const result = classifyToolRisk({
      name: "create_page",
      description: "Create a new page in the workspace",
    });
    assert.equal(result.riskLevel, "medium");
    assert.equal(result.approvalRequired, true);
  });

  it("classifies read verbs as low without approval", () => {
    for (const description of [
      "Search the workspace for pages matching a query",
      "List all databases in the workspace",
      "Fetch documentation for a library",
    ]) {
      const result = classifyToolRisk({ name: "get_things", description });
      assert.equal(result.riskLevel, "low", `"${description}" must be low`);
      assert.equal(result.approvalRequired, false);
    }
  });

  it("does not trust readOnlyHint when the description shows write verbs", () => {
    // Untrusted annotation claiming read-only while the text says otherwise.
    const result = classifyToolRisk({
      name: "tool",
      description: "Delete a page (read-only hint is a lie)",
      annotations: { readOnlyHint: true },
    });
    assert.notEqual(result.riskLevel, "low");
    assert.equal(result.approvalRequired, true);
  });

  it("falls back to medium + approval for unknown verbs", () => {
    const result = classifyToolRisk({
      name: "frobnicate",
      description: "Frobnicate the widget",
    });
    assert.equal(result.riskLevel, "medium");
    assert.equal(result.approvalRequired, true);
  });
});

describe("description sanitization", () => {
  it("strips control characters and collapses whitespace", () => {
    const dirty = "Hello \u0000 \u0001 world\n\n\t  again\u007f";
    const clean = sanitizeDescription(dirty);
    assert.ok(!/[\x00-\x1f\x7f]/.test(clean));
    assert.equal(clean, "Hello world again");
  });

  it("caps long descriptions", () => {
    const long = "x".repeat(5_000);
    const clean = sanitizeDescription(long);
    // Keeps MAX chars of content plus a "..." marker.
    assert.equal(clean.length, MAX_TOOL_DESCRIPTION_CHARS + 2);
    assert.ok(clean.endsWith("..."));
  });

  it("handles non-string input", () => {
    assert.equal(sanitizeDescription(42), "");
    assert.equal(sanitizeDescription(null), "");
    assert.equal(sanitizeDescription({ evil: true }), "");
  });
});

describe("secret redaction", () => {
  it("redacts common token shapes", () => {
    const text =
      "Authorization failed for sk-abc123DEF456 and Bearer eyJhbGciOi.eyJzdWIiOiJ4In0.sig and api_key=supersecret123";
    const redacted = redactSecrets(text);
    assert.ok(!redacted.includes("sk-abc123DEF456"));
    assert.ok(!redacted.includes("eyJzdWIiOiJ4In0"));
    assert.ok(!redacted.includes("supersecret123"));
    assert.ok(redacted.includes("[redacted]"));
  });

  it("leaves ordinary text alone", () => {
    const text = 'The page titled "Notes" was not found.';
    assert.equal(redactSecrets(text), text);
  });
});

describe("MCP tool namespacing", () => {
  it("namespaces and sanitizes remote tool names", () => {
    assert.equal(
      namespacedToolName("context7", "resolve-library-id"),
      "mcp_context7_resolve_library_id",
    );
    assert.equal(namespacedToolName("notion", "search"), "mcp_notion_search");
  });

  it("produces model-safe names (letters/underscore only)", () => {
    const name = namespacedToolName("my-server!", "weird tool name (v2)!");
    assert.match(name, /^[a-zA-Z_][a-zA-Z0-9_]*$/);
    assert.ok(name.length <= 60);
  });

  it("never collides with built-in tool names", () => {
    // A malicious server exposing a tool named like a built-in still gets
    // the mcp_ prefix, so it can never shadow write_note / web_search.
    const name = namespacedToolName("evil", "write_note");
    assert.notEqual(name, "write_note");
    assert.ok(name.startsWith("mcp_"));
  });

  it("is deterministic for the same input", () => {
    assert.equal(
      namespacedToolName("stripe", "create_customer"),
      namespacedToolName("stripe", "create_customer"),
    );
  });

  it("handles degenerate fragments", () => {
    const name = namespacedToolName("---", "!!!");
    assert.match(name, /^[a-zA-Z_][a-zA-Z0-9_]*$/);
  });
});
