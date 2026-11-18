import { AgentPatchSchema } from "@agent/shared";

import { requireUser, toErrorResponse } from "@/lib/auth";
import {
  AGENT_COLUMNS,
  assertKnownModels,
  storedAvatar,
  toPublicAgent,
  type AgentRow,
} from "@/lib/agents";
import { supabaseAdmin } from "@/lib/supabase/server";
import { zodMessage } from "@/lib/zod-error";

/**
 * PATCH /api/agents/:id — update the caller's agent (name, role,
 *        instructions, model + fallback order, avatar, isSupervisor).
 * DELETE /api/agents/:id — remove it. MCP attachments/permissions cascade;
 *        runs and threads keep their history (the agent link goes stale and
 *        renders with the default avatar).
 */

const notFound = () =>
  Response.json(
    { error: { code: "not_found", message: "Unknown agent." } },
    { status: 404 },
  );

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // An empty string means "clear this field" (the editor sends "" for
    // emptied inputs); name keeps its min-length validation instead.
    const normalized = { ...raw };
    for (const key of ["role", "instructions", "model"] as const) {
      if (normalized[key] === "") normalized[key] = null;
    }

    const parsed = AgentPatchSchema.safeParse(normalized);
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }

    const admin = supabaseAdmin();
    const { data: existing, error: fetchError } = await admin
      .from("agents")
      .select(AGENT_COLUMNS)
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (fetchError) throw new Error(`Could not read agent: ${fetchError.message}`);
    if (!existing) return notFound();

    const current = existing as AgentRow;
    const patch = parsed.data;

    // Validate the *effective* model set (the patch may only change one side).
    const effectiveModel = patch.model !== undefined ? patch.model : current.model;
    const effectiveFallbacks =
      patch.fallbackModels !== undefined ? patch.fallbackModels : (current.fallback_models ?? []);
    await assertKnownModels(effectiveModel, effectiveFallbacks);

    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.role !== undefined) update.role = patch.role ?? null;
    if (patch.instructions !== undefined) update.system_prompt = patch.instructions ?? null;
    if (patch.model !== undefined) update.model = patch.model ?? null;
    if (patch.fallbackModels !== undefined) update.fallback_models = patch.fallbackModels;
    if (patch.avatar !== undefined) update.avatar = storedAvatar(patch.avatar);
    if (patch.isSupervisor !== undefined) update.is_supervisor = patch.isSupervisor;
    if (Object.keys(update).length === 0) {
      return Response.json({ agent: await toPublicAgent(current) });
    }

    const { data, error } = await admin
      .from("agents")
      .update(update)
      .eq("id", id)
      .eq("user_id", user.id)
      .select(AGENT_COLUMNS)
      .single();
    if (error) throw new Error(`Could not update agent: ${error.message}`);

    return Response.json({ agent: await toPublicAgent(data as AgentRow) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;

    const { data, error } = await supabaseAdmin()
      .from("agents")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id");
    if (error) throw new Error(`Could not delete agent: ${error.message}`);
    if (!data?.length) return notFound();

    return Response.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
