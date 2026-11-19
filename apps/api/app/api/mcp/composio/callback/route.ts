import { supabaseAdmin } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { isComposioCallbackState, verifyComposio } from "@/lib/mcp/providers/composio";
import { redactSecrets } from "@/lib/mcp/security/redact-secrets";
import type { ConnectionRow } from "@/lib/mcp/connections";

/**
 * GET /api/mcp/composio/callback — public redirect target for Composio's
 * hosted consent link (pending → authorize → verify flow).
 *
 * The browser lands here after the user finishes (or abandons) sign-in.
 * A browser redirect carries no Bearer header, so the trust anchor is the
 * `state` nonce WE minted into the callback_url when the link was created
 * (same pattern as the OAuth callback's PKCE state): it is stored on the
 * connection row and must match, which also binds the request to that row's
 * owner. When an Authorization header IS present (e.g. a same-origin web
 * session), it must belong to the connection's user.
 *
 * It runs the same `verifyComposio()` as POST /connections/:id/verify and
 * then deep-links back into the app with the outcome
 * (`agentapp://mcp/<serverId>?status=…`), mirroring the OAuth callback.
 */

function htmlRedirect(target: string, error?: string): Response {
  const message = error
    ? `Connection failed: ${error}. You can close this tab and retry in the app.`
    : "Signed in! Returning to the app…";
  const safeTarget = target.replace(/"/g, "&quot;");
  const safeMessage = message.replace(/</g, "&lt;");
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Agent</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0b0b0f;color:#eee">
<div style="text-align:center;max-width:28rem;padding:1.5rem">
<p style="font-size:1.05rem">${safeMessage}</p>
<p><a href="${safeTarget}" style="color:#7aa2ff">Open the app</a></p>
</div>
<script>setTimeout(function(){window.location.replace("${safeTarget}")},250)</script>
</body></html>`,
    {
      status: error ? 502 : 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

/** Deep link to this listing's detail screen (serverId only as a path segment). */
function appTarget(query: string, serverId?: string): string {
  const path = serverId && /^[A-Za-z0-9-]{1,64}$/.test(serverId) ? `mcp/${serverId}` : "mcp";
  return `agentapp://${path}${query ? `?${query}` : ""}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connectionId");
  const state = url.searchParams.get("state") ?? "";
  const errorParam = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (!connectionId || !/^[0-9a-fA-F-]{36}$/.test(connectionId)) {
    return htmlRedirect(appTarget("status=error&message=bad_state"), "Missing connection");
  }

  // Locate the connection (public route: trust the minted state, not a session).
  const { data } = await supabaseAdmin()
    .from("user_mcp_connections")
    .select("id, user_id, mcp_server_id, metadata")
    .eq("id", connectionId)
    .maybeSingle();
  if (!data) {
    return htmlRedirect(appTarget("status=error&message=not_found"), "Unknown connection");
  }
  const row = data as Pick<ConnectionRow, "id" | "user_id" | "mcp_server_id"> & {
    metadata: Record<string, unknown>;
  };
  const serverId = row.mcp_server_id;

  const session = row.metadata?.composio_session as
    | { callbackStates?: unknown }
    | undefined;
  const states = Array.isArray(session?.callbackStates)
    ? session.callbackStates.filter((value): value is string => typeof value === "string")
    : [];
  if (!isComposioCallbackState(state, states)) {
    return htmlRedirect(
      appTarget("status=error&message=bad_state", serverId),
      "Unrecognized sign-in link",
    );
  }

  // Belt and braces: if the browser did carry a session, it must be the owner.
  if (request.headers.get("authorization")) {
    try {
      const user = await requireUser(request);
      if (user.id !== row.user_id) {
        return htmlRedirect(
          appTarget("status=error&message=forbidden", serverId),
          "This link belongs to another account",
        );
      }
    } catch {
      return htmlRedirect(
        appTarget("status=error&message=forbidden", serverId),
        "This link belongs to another account",
      );
    }
  }

  if (errorParam) {
    // The user cancelled or Composio refused → stay pending/error, never
    // `connected` (verify reads the real account state below for `error`).
    const message = redactSecrets(errorDescription ?? errorParam).slice(0, 200);
    return htmlRedirect(
      appTarget(`status=error&message=${encodeURIComponent(message)}`, serverId),
      message,
    );
  }

  try {
    // No link is minted here; the app polls /connections/:id/verify afterwards
    // in case the account is still INITIALIZING when the redirect lands.
    const result = await verifyComposio({
      userId: row.user_id,
      connectionId: row.id,
      issueLink: false,
    });

    if (result.status === "connected") {
      return htmlRedirect(appTarget("status=connected", serverId));
    }
    if (result.status === "pending") {
      return htmlRedirect(appTarget("status=pending", serverId));
    }
    const message = redactSecrets(result.message ?? `status_${result.status}`).slice(0, 200);
    return htmlRedirect(
      appTarget(`status=error&message=${encodeURIComponent(message)}`, serverId),
      message,
    );
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error)).slice(
      0,
      200,
    );
    return htmlRedirect(
      appTarget(`status=error&message=${encodeURIComponent(message)}`, serverId),
      message,
    );
  }
}
