-- Debug trail: why a provider attempt failed or was skipped.
-- Apply with the other migrations (Supabase SQL editor).

alter table provider_usage add column if not exists detail text;
