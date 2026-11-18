-- Phase 6 addendum: seed the Composio marketplace listing.
--
-- Composio is the one provider-backed catalog entry (spec: phase-6 plan §6.1,
-- "Primary provider"). There is no endpoint of ours: on connect the adapter
-- (apps/api/lib/mcp/providers/composio.ts) creates a per-user tool-router
-- session against Composio and stores the returned MCP URL + headers, so this
-- row only carries the provider name and the toolkits the session exposes.
--
-- Requires COMPOSIO_API_KEY on the server (docs/runbook-phase-0.md §6c).
--
-- Verified against current docs 2026-11-18:
--   Session API  docs.composio.dev/reference/api-reference/tool-router/postToolRouterSession
--   Free plan    composio.dev/pricing — Hobby: 100,000 tool calls/month, 2,000 req/min
-- Toolkit slugs are lowercase (docs.composio.dev/toolkits).

insert into mcp_servers
  (slug, name, description, instructions, provider, category, endpoint, transport, auth_type,
   config, capabilities, is_verified, is_free_tier)
values
  ('composio', 'Composio',
   'One connection to 100+ apps — Gmail, GitHub, Slack, Notion, Google Calendar and more. Composio hosts the tools and handles each account''s OAuth; only the tools you enable for an agent are exposed.',
   '1. Tap Connect and pick the apps you want to grant — Composio opens each app''s own consent screen.
2. Open an agent → Edit → Integrations and turn on the Composio tools that agent may use.
3. Tools that send messages or change data ask for approval the first time.',
   'composio', 'productivity', null, 'streamable_http', 'provider_managed',
   '{"toolkits": ["gmail", "github", "slack", "notion", "googlecalendar"],
     "metadata": {"docs": "https://docs.composio.dev",
                  "pricing": "Free (Hobby): 100,000 tool calls/month, no card."}}'::jsonb,
   '{"tools": true}', true, true)
on conflict (slug) do nothing;

-- PostgREST caches the schema; notify it so the new row is visible without
-- waiting for its reload interval.
notify pgrst, 'reload schema';
