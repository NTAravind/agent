import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  GroupCreateSchema,
  GroupHandoffPayloadSchema,
  GroupMembersSchema,
  GroupModeSchema,
  GroupPatchSchema,
  MAX_GROUP_MEMBERS,
} from "@agent/shared";

const agentId = "6f9d5a1e-0f3f-4a5e-9c2f-1b2c3d4e5f60";
const otherAgentId = "7a0e6b2f-1f40-45bf-8d3f-2c3d4e5f6071";

test("GroupCreateSchema accepts a valid group", () => {
  const parsed = GroupCreateSchema.safeParse({
    name: "Research crew",
    description: "Research and review together",
    leadAgentId: agentId,
    memberIds: [otherAgentId],
    mode: "handoff",
    maxHops: 6,
    tokenBudget: 20_000,
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.leadAgentId, agentId);
    assert.equal(parsed.data.memberIds?.length, 1);
  }
});

test("GroupCreateSchema rejects invalid limits and modes", () => {
  assert.equal(GroupCreateSchema.safeParse({
    name: "Bad",
    leadAgentId: agentId,
    maxHops: 0,
  }).success, false);
  assert.equal(GroupCreateSchema.safeParse({
    name: "Bad",
    leadAgentId: agentId,
    tokenBudget: 999,
  }).success, false);
  assert.equal(GroupCreateSchema.safeParse({
    name: "Bad",
    leadAgentId: agentId,
    mode: "committee",
  }).success, false);
  assert.equal(GroupCreateSchema.safeParse({
    name: "Bad",
    leadAgentId: "not-a-uuid",
  }).success, false);
});

test("GroupPatchSchema permits an empty metadata update", () => {
  assert.equal(GroupPatchSchema.safeParse({}).success, true);
  assert.equal(GroupPatchSchema.safeParse({ name: "Renamed" }).success, true);
  assert.equal(GroupPatchSchema.safeParse({ name: "" }).success, false);
});

test("GroupMembersSchema requires a lead and at least one member", () => {
  assert.equal(GroupMembersSchema.safeParse({
    leadAgentId: agentId,
    memberIds: [otherAgentId],
  }).success, true);
  assert.equal(GroupMembersSchema.safeParse({
    leadAgentId: agentId,
    memberIds: [],
  }).success, false);
  assert.equal(GroupMembersSchema.safeParse({ memberIds: [otherAgentId] }).success, false);
});

test("GroupModeSchema supports only the two dynamic modes", () => {
  assert.equal(GroupModeSchema.safeParse("handoff").success, true);
  assert.equal(GroupModeSchema.safeParse("roundtable").success, true);
  assert.equal(GroupModeSchema.safeParse("supervisor").success, false);
});

test("GroupHandoffPayloadSchema persists the required from, to and task fields", () => {
  const parsed = GroupHandoffPayloadSchema.safeParse({
    from: agentId,
    to: otherAgentId,
    task: "Review the findings",
  });
  assert.equal(parsed.success, true);
  assert.equal(GroupHandoffPayloadSchema.safeParse({
    from: agentId,
    to: otherAgentId,
  }).success, false);
});

test("the membership cap counts the lead", () => {
  const ids = Array.from({ length: MAX_GROUP_MEMBERS + 1 }, () => randomUUID());
  // The lead plus MAX_GROUP_MEMBERS - 1 other members is the largest group.
  assert.equal(
    GroupCreateSchema.safeParse({
      name: "Full",
      leadAgentId: ids[0],
      memberIds: ids.slice(1, MAX_GROUP_MEMBERS),
    }).success,
    true,
  );
  // One more member crosses the cap.
  assert.equal(
    GroupCreateSchema.safeParse({
      name: "Too full",
      leadAgentId: ids[0],
      memberIds: ids.slice(1, MAX_GROUP_MEMBERS + 1),
    }).success,
    false,
  );
  assert.equal(
    GroupMembersSchema.safeParse({
      leadAgentId: ids[0],
      memberIds: ids.slice(1, MAX_GROUP_MEMBERS + 1),
    }).success,
    false,
  );
});
