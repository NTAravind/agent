-- The app has one account, provisioned through email/password sign-up. Enforce
-- the limit at auth.users so direct Auth API calls cannot bypass it.
-- Refuse to install while duplicate users exist instead of silently picking one.
do $$
begin
  if (select count(*) from auth.users) > 1 then
    raise exception 'Multiple Supabase Auth users already exist. Remove extra accounts before enabling single-account auth.';
  end if;
end;
$$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.enforce_single_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  -- Serialize simultaneous first-account signups, including retries.
  perform pg_advisory_xact_lock(764223190246::bigint);

  if exists (select 1 from auth.users limit 1) then
    raise exception 'Only one account is supported. Sign in with the existing account.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_single_auth_user() from public, anon, authenticated;

drop trigger if exists enforce_single_auth_user on auth.users;
create trigger enforce_single_auth_user
  before insert on auth.users
  for each row execute function private.enforce_single_auth_user();
