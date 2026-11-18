-- Phase 6 addendum: setup instructions on marketplace listings.
--
-- Admins write short setup steps in the dashboard ("1. Go to
-- platform.example.com → Settings → Integrations … 2. Copy the token"). The
-- mobile integration screen shows them above the connect form. Never secrets —
-- API keys are entered by the user and stored encrypted in
-- user_mcp_connections, never in the catalog.

alter table mcp_servers
  add column if not exists instructions text not null default '';

comment on column mcp_servers.instructions is
  'Setup steps shown to the user when connecting. Never secrets.';

-- Refresh PostgREST's schema cache so the new column is immediately usable.
notify pgrst, 'reload schema';
