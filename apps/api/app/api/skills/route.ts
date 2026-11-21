import { SkillCreateSchema } from "@agent/shared";

import { requireUser, toErrorResponse } from "@/lib/auth";
import { listSkillsWithAssignments, rowToSkill } from "@/lib/skills/load";
import { composeSkillFile, slugifyName, upsertSkillIndex } from "@/lib/skills/sync";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isVaultConfigured, putVaultFile } from "@/lib/vault/github";
import { zodMessage } from "@/lib/zod-error";

/**
 * GET  /api/skills — the user's skills, each with its assigned agent ids.
 * POST /api/skills — create a skill. The vault is the source of truth, so
 *        the SKILL.md file is committed first (user-initiated → no approval),
 *        then the index row is upserted. Without a configured vault the row
 *        is still written so the app stays usable (vaultCommitted: false).
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const skills = await listSkillsWithAssignments(user.id);
    return Response.json({ skills });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);

    const parsed = SkillCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: { code: "bad_request", message: zodMessage(parsed.error) } },
        { status: 400 },
      );
    }
    const input = parsed.data;
    const slug = input.slug ?? slugifyName(input.name);
    const vaultPath = `skills/${slug}/SKILL.md`;

    const { data: existing } = await supabaseAdmin()
      .from("skills")
      .select("id")
      .eq("user_id", user.id)
      .eq("slug", slug)
      .maybeSingle();
    if (existing) {
      return Response.json(
        { error: { code: "conflict", message: `A skill with the slug "${slug}" already exists.` } },
        { status: 409 },
      );
    }

    let gitSha: string | null = null;
    let vaultCommitted = false;
    if (isVaultConfigured()) {
      const written = await putVaultFile(
        vaultPath,
        composeSkillFile({
          name: input.name,
          description: input.description,
          tools: input.tools,
          body: input.body,
        }),
      );
      gitSha = written.sha;
      vaultCommitted = true;
    }

    const row = await upsertSkillIndex(user.id, {
      slug,
      name: input.name,
      description: input.description,
      tools: input.tools ?? [],
      body: input.body,
      vaultPath,
      gitSha: gitSha ?? "",
    });

    return Response.json({ skill: rowToSkill(row, []), vaultCommitted }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
