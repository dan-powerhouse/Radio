-- Stock PostgreSQL fixture for the managed Broadcast table and topic accessor.
-- SQL atomicity and RLS are real. Native Realtime supplies delivery and
-- validates the socket's credentials outside this fixture.
create schema realtime;
create function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic',true),'')
$$;
create table realtime.messages (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  extension text not null,
  event text,
  payload jsonb,
  private boolean default false
);
alter table realtime.messages enable row level security;
grant usage on schema realtime to anon, authenticated, service_role;
grant select, insert on realtime.messages to anon, authenticated, service_role;
