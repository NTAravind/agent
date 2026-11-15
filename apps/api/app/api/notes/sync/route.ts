import { requireUser, toErrorResponse } from "@/lib/auth";
import { inngest } from "@/lib/inngest/client";
import { vaultChanged } from "@/lib/inngest/events";
import { isVaultConfigured, vaultRepo } from "@/lib/vault/github";
import { syncVault } from "@/lib/vault/sync";

/**
 * POST /api/notes/sync — re-index the vault.
 *
 * By default the sync is queued on Inngest (a big vault can take longer than
 * a serverless request). Pass {"inline": true} to run it in this request
 * (handy locally).
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);

    if (!isVaultConfigured()) {
      return Response.json(
        {
          error: {
            code: "not_configured",
            message:
              "The GitHub vault is not configured. Set GITHUB_VAULT_TOKEN and GITHUB_VAULT_REPO.",
          },
        },
        { status: 503 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as { inline?: boolean };

    if (body.inline) {
      const result = await syncVault(user.id);
      return Response.json({ ok: true, inline: true, ...result });
    }

    await inngest.send(vaultChanged.create({ userId: user.id }));
    return Response.json(
      {
        ok: true,
        queued: true,
        repo: vaultRepo() ? `${vaultRepo()!.owner}/${vaultRepo()!.repo}` : null,
      },
      { status: 202 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
