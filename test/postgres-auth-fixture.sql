-- Disposable, stock PostgreSQL test database only.
-- Do not apply to a Supabase project: Supabase supplies its own Auth roles and
-- functions, which must be tested independently in the hosted integration gate.
-- This fixture supplies the minimal claim accessors expected by 0001_radio.sql.
-- SQL/RLS/transactions are real; authentication and Realtime are NOT simulated
-- and no OAuth or WebSocket conformance claim follows from these tests.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select (auth.jwt()->>'sub')::uuid
$$;
grant usage on schema auth to anon,authenticated,service_role;
create publication supabase_realtime;
