import { SkillPatchSchema } from "@agent/shared";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { SKILL_COLUMNS, rowToSkill, type SkillRow } from "@/lib/skills/load";
import { composeSkillFile, upsertSkillIndex } from "@/lib/skills/sync";
import { supabaseAdmin } from "@/lib/supabase/server";
import { deleteVaultFile, isVaultConfigured, putVaultFile } from "@/lib/vault/github";
import { zodMessage } from "@/lib/zod-error";

/**
 * PATCH /api/skills/:id — edit a skill (recomposes SKILL.md, commits it to
 *        the vault, then refreshes the index row).
 * DELETE /api/skills/:id — delete the vault file (cascades agent_skills).
 * Both are user-initiated writes → no approval, per the skills design.
 */

const notFound = () =>
  Response.json({ error: { code: "not_found", message: "Unknown skill." } }, { status: 404 });

async function ownedSkill(userId: string, id: string): Promise<SkillRow | null> {
  const { data } = await supabaseAdmin()
    .from("skills")
    .select(SKILL_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as SkillRow | null) ?? null;
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;

    const current = await ownedSkill(user.id, id);
    if (!current) return notFound();

    const parsed = SkillPatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }
    const patch = parsed.data;

    const name = patch.name ?? current.name;
    const description = patch.description ?? current.description;
    const tools = patch.tools ?? current.tools ?? [];
    const body = patch.body ?? current.body;
    const enabled = patch.enabled ?? current.enabled;
    const vaultPath = current.vault_path ?? `skills/${current.slug}/SKILL.md`;

    // Only touch GitHub when the file content actually changed — the
    // contents API rejects an identical PUT (422 content is identical).
    const contentChanged =
      name !== current.name ||
      description !== current.description ||
      body !== current.body ||
      JSON.stringify(tools) !== JSON.stringify(current.tools ?? []);

    let gitSha = current.git_sha;
    let vaultCommitted = false;
    if (isVaultConfigured() && contentChanged) {
      const written = await putVaultFile(
        vaultPath,
        composeSkillFile({ name, description, tools, body }),
      );
      gitSha = written.sha;
      vaultCommitted = true;
    }

    const row = await upsertSkillIndex(user.id, {
      slug: current.slug,
      name,
      description,
      tools,
      body,
      vaultPath,
      gitSha: gitSha ?? "",
    });
    // `enabled` is app state, not vault state — apply it after the upsert.
    if (enabled !== current.enabled) {
      const { data: updated } = await supabaseAdmin()
        .from("skills")
        .update({ enabled })
        .eq("id", row.id)
        .eq("user_id", user.id)
        .select(SKILL_COLUMNS)
        .single();
      if (updated) return Response.json({ skill: rowToSkill(updated as SkillRow, []), vaultCommitted });
    }

    return Response.json({ skill: rowToSkill(row, []), vaultCommitted });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;

    const current = await ownedSkill(user.id, id);
    if (!current) return notFound();

    // Vault first: if the delete fails the row stays and the next sync
    // re-creates it (vault is the source of truth).
    if (isVaultConfigured() && current.vault_path) {
      await deleteVaultFile(current.vault_path);
    }

    const { error } = await supabaseAdmin()
      .from("skills")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) throw new Error(`Could not delete the skill: ${error.message}`);

    return Response.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
