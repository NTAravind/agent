-- 0013: Composio connections must be pending until OAuth actually completes.
--
-- The old connectComposio() flipped every row to 'connected' as soon as a
-- Tool Router session was created — a session only proves the user id exists
-- in Composio, it carries NO consent. So every existing provider_managed
-- (Composio) row claims "connected" while the user has authorized nothing,
-- and the marketplace shows every toolkit as connected.
--
-- Reset those rows to 'pending'. Nothing is lost: the session endpoint and
-- cached tool definitions stay (they are re-used on the next connect), and
-- POST /api/mcp/connections/:id/verify flips a row back to 'connected' on
-- its own if Composio already reports an ACTIVE connected account for the
-- toolkit — otherwise the app shows "Finish connecting" and the hosted link.
--
-- Apply with: supabase db push  |  or paste into the Supabase SQL editor.

UPDATE user_mcp_connections AS c
SET status = 'pending',
    updated_at = now()
FROM mcp_servers AS s
WHERE s.id = c.mcp_server_id
  AND s.provider = 'composio'
  AND c.auth_type = 'provider_managed'
  AND c.status = 'connected';

NOTIFY pgrst, 'reload schema';
