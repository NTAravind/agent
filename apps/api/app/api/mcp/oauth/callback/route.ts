import { supabaseAdmin } from "@/lib/supabase/server";
import { connectionIdFromState, completeAuthorization, oauthRedirectUrl } from "@/lib/mcp/oauth";
import { updateConnection } from "@/lib/mcp/connections";
import { refreshConnection } from "@/lib/mcp/providers/direct-remote";
import { redactSecrets } from "@/lib/mcp/security/redact-secrets";
import type { ConnectionRow } from "@/lib/mcp/connections";

/**
 * GET /api/mcp/oauth/callback — public OAuth redirect target (Phase 6 §6.4).
 *
 * The browser lands here with ?code&state&iss. The code is exchanged
 * SERVER-SIDE (it never reaches the phone), tokens are persisted encrypted,
 * tools are discovered, then the user is deep-linked back into the app
 * (`pacbot://mcp?...`). The `state` parameter encodes the connection id and
 * is verified by `auth()` against the stored state (CSRF/PKCE).
 *
 * This route must stay public (no Bearer header exists in a browser
 * redirect); its only trust anchor is state + PKCE.
 */

function htmlRedirect(target: string, error?: string): Response {
  const message = error
    ? `Connection failed: ${error}. You can close this tab and retry in the app.`
    : "Connected! Returning to the app…";
  const safeTarget = target.replace(/"/g, "&quot;");
  const safeMessage = message.replace(/</g, "&lt;");
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Pacbot</title></head>
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const issuer = url.searchParams.get("iss") ?? undefined;
  const errorParam = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  // Deep-link back to the marketplace detail screen for this server when we
  // can identify it, else the marketplace list. (serverId is only used as a
  // path segment — sanitized.)
  const appTarget = (query: string, serverId?: string): string => {
    const path =
      serverId && /^[A-Za-z0-9-]{1,64}$/.test(serverId) ? `mcp/${serverId}` : "mcp";
    return `pacbot://${path}${query ? `?${query}` : ""}`;
  };

  if (errorParam) {
    return htmlRedirect(
      appTarget(`status=error&message=${encodeURIComponent(errorDescription ?? errorParam)}`),
      errorDescription ?? errorParam,
    );
  }

  if (!code || !state) {
    return htmlRedirect(appTarget("status=error&message=missing_code"), "Missing code or state");
  }

  const connectionId = connectionIdFromState(state);
  if (!connectionId) {
    return htmlRedirect(appTarget("status=error&message=bad_state"), "Unrecognized state");
  }

  // Locate the connection (public route: trust state, not a session).
  const { data: row } = await supabaseAdmin()
    .from("user_mcp_connections")
    .select("id, user_id, mcp_server_id, metadata")
    .eq("id", connectionId)
    .maybeSingle();

  if (!row) {
    return htmlRedirect(appTarget("status=error&message=not_found"), "Unknown connection");
  }

  const connection = row as Pick<ConnectionRow, "id" | "user_id" | "mcp_server_id"> & {
    metadata: Record<string, unknown>;
  };

  // The server URL comes from the catalog (admin-seeded), never the request.
  const { data: server } = await supabaseAdmin()
    .from("mcp_servers")
    .select("endpoint")
    .eq("id", connection.mcp_server_id)
    .maybeSingle();

  const serverId = connection.mcp_server_id;
  const serverUrl = (server?.endpoint as string | null) ?? "";
  if (!serverUrl) {
    return htmlRedirect(
      appTarget("status=error&message=no_endpoint", serverId),
      "Integration has no endpoint",
    );
  }

  try {
    await completeAuthorization({
      connectionId: connection.id,
      userId: connection.user_id,
      serverUrl,
      code,
      state,
      ...(issuer ? { issuer } : {}),
    });
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    await updateConnection(connection.user_id, connection.id, { status: "error" }).catch(
      () => undefined,
    );
    return htmlRedirect(
      appTarget(`status=error&message=${encodeURIComponent(message)}`, serverId),
      message,
    );
  }

  // Authorized → discover tools and mark connected (redacted on failure).
  try {
    await refreshConnection({ userId: connection.user_id, connectionId: connection.id });
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    await updateConnection(connection.user_id, connection.id, { status: "error" }).catch(
      () => undefined,
    );
    return htmlRedirect(
      appTarget(`status=error&message=${encodeURIComponent(message)}`, serverId),
      message,
    );
  }

  return htmlRedirect(appTarget("status=connected", serverId));
}
