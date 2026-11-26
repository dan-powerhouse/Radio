-- A row explicitly enables issuance and joins after the native profile is qualified.
create table radio_v2.broadcast_settings (
  singleton boolean primary key default true check (singleton),
  issuer text not null check (length(issuer) between 1 and 2048)
);
alter table radio_v2.broadcast_settings enable row level security;
revoke all on radio_v2.broadcast_settings from public, anon, authenticated, service_role;
grant select on radio_v2.broadcast_settings to service_role;

-- Realtime supplies verified JWT claims when evaluating the channel policy.
-- The function exposes only a Boolean from the private institutional grants.
create function radio_v2.can_listen() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  claims jsonb := auth.jwt();
  uuid_pattern constant text := '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$';
  now_seconds numeric := extract(epoch from statement_timestamp());
  issued bigint;
  expires bigint;
begin
  if claims->>'role' is distinct from 'authenticated'
     or claims->>'aud' is distinct from 'authenticated'
     or claims ? 'client_id' or claims->'is_anonymous' is distinct from 'false'::jsonb
     or not coalesce(claims->>'sub' ~ uuid_pattern, false)
     or not coalesce(claims->>'session_id' ~ uuid_pattern, false)
     or jsonb_typeof(claims->'iat') is distinct from 'number'
     or jsonb_typeof(claims->'exp') is distinct from 'number'
     or not coalesce(claims->>'iat' ~ '^[0-9]{1,12}$', false)
     or not coalesce(claims->>'exp' ~ '^[0-9]{1,12}$', false) then
    return false;
  end if;
  issued := (claims->>'iat')::bigint;
  expires := (claims->>'exp')::bigint;
  return issued <= now_seconds and expires > now_seconds and expires - issued <= 300
    and exists (select from radio_v2.broadcast_settings where issuer = claims->>'iss')
    and exists (select from radio_v2.authority a
      where a.principal = (claims->>'sub')::uuid and radio_v2.permitted(a,null,'read_public'));
end $$;
revoke execute on function radio_v2.can_listen() from public, anon, authenticated, service_role;
grant execute on function radio_v2.can_listen() to anon, authenticated;

-- A restrictive guard also applies if another policy permits a wider topic set.
create policy radio_v2_protect_receipt_signals on realtime.messages as restrictive
  for select to anon, authenticated using (
    (topic is distinct from 'radio:v2:receipts' and (select realtime.topic()) is distinct from 'radio:v2:receipts')
    or ((select realtime.topic()) = 'radio:v2:receipts' and topic = 'radio:v2:receipts'
      and extension = 'broadcast' and (select radio_v2.can_listen()))
  );
create policy radio_v2_read_receipt_signals on realtime.messages
  for select to authenticated using (
    (select realtime.topic()) = 'radio:v2:receipts' and topic = 'radio:v2:receipts' and extension = 'broadcast'
  );
create policy radio_v2_block_client_receipt_signals on realtime.messages as restrictive
  for insert to anon, authenticated with check (
    topic is distinct from 'radio:v2:receipts' and (select realtime.topic()) is distinct from 'radio:v2:receipts'
  );

-- Native Broadcast replicates these rows after commit. Use the same managed
-- message representation as realtime.send, with insertion errors propagated
-- so an enabled enqueue remains atomic with the receipt and its evidence.
create function radio_v2.signal_receipt() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select from radio_v2.broadcast_settings) then
    insert into realtime.messages (id, payload, event, topic, private, extension)
    values (gen_random_uuid(), jsonb_build_object('id',new.id),
      'receipt', 'radio:v2:receipts', true, 'broadcast');
  end if;
  return new;
end $$;
revoke execute on function radio_v2.signal_receipt() from public, anon, authenticated, service_role;

create trigger receipt_signal after insert on radio_v2.receipts
  for each row execute function radio_v2.signal_receipt();
