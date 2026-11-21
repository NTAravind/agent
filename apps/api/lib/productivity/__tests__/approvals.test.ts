import assert from "node:assert/strict";
import { test } from "node:test";

import { needsApproval } from "../../approvals";

test("creating, listing and completing never needs approval", () => {
  for (const tool of ["create_task", "list_tasks", "complete_task", "create_event", "list_events"]) {
    assert.equal(needsApproval(tool, {}, null), false, tool);
  }
});

test("deleting always needs approval — including agent-created items", () => {
  assert.equal(needsApproval("delete_task", { id: "abc" }, "agent"), true);
  assert.equal(needsApproval("delete_event", { id: "abc" }, "user"), true);
  assert.equal(needsApproval("write_note", { path: "a.md" }, "agent"), true);
});

test("editing a user-created item needs approval", () => {
  assert.equal(needsApproval("update_task", { id: "abc" }, "user"), true);
  assert.equal(needsApproval("update_event", { id: "abc" }, "user"), true);
});

test("editing an agent-created item does not need approval", () => {
  assert.equal(needsApproval("update_task", { id: "abc" }, "agent"), false);
  assert.equal(needsApproval("update_event", { id: "abc" }, "agent"), false);
});

test("editing a suggested item does not need approval", () => {
  assert.equal(needsApproval("update_task", { id: "abc" }, "suggested"), false);
});

test("an unverifiable target needs approval", () => {
  // No id at all.
  assert.equal(needsApproval("update_task", {}, "user"), true);
  // The row no longer exists (or is not owned by the user).
  assert.equal(needsApproval("update_task", { id: "abc" }, null), true);
  assert.equal(needsApproval("update_task", { id: "abc" }, undefined), true);
});
