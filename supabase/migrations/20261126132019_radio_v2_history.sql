-- A stored top-level transaction ID does not wrap with xmin. Membership in
-- a closed window is snapshot visibility, independent of allocation order.
alter table radio_v2.receipts add column written xid8 not null default pg_current_xact_id();
create index receipt_history_order on radio_v2.receipts (written, id);

create table radio_v2.history_cursors (
  token uuid primary key default gen_random_uuid(),
  principal uuid not null,
  client uuid,
  revision bigint not null,
  scope radio_v2.address not null,
  previous pg_snapshot,
  ceiling pg_snapshot not null,
  position_xid xid8,
  position_id radio_v2.address,
  expires timestamptz not null,
  check ((position_xid is null) = (position_id is null))
);
create index history_cursor_expiry on radio_v2.history_cursors (expires);
alter table radio_v2.history_cursors enable row level security;
revoke all on radio_v2.history_cursors from public, anon, authenticated, service_role;
grant select, insert, delete on radio_v2.history_cursors to service_role;

create function public.radio_v2_history(p_principal uuid, p_client uuid,
  p_scope radio_v2.address, p_after uuid, p_limit integer)
returns jsonb language plpgsql set search_path = '' as $$
declare
  a radio_v2.authority;
  cursor_row radio_v2.history_cursors;
  floor_snapshot pg_snapshot;
  window_snapshot pg_snapshot;
  last_xid xid8;
  last_id radio_v2.address;
  row_item record;
  entries text[] := '{}';
  size_bytes integer := 0;
  page_limit integer := least(p_limit, 64);
  has_more boolean := false;
  new_token uuid;
  now_at timestamptz := statement_timestamp();
  deadline timestamptz := now_at + interval '24 hours';
begin
  select * into a from radio_v2.authority where principal = p_principal for share;
  if not radio_v2.permitted(a, p_client, 'read_public') then
    return jsonb_build_object('kind','forbidden');
  end if;
  if p_scope is null or p_limit is null or p_limit not between 1 and 1000 then
    return jsonb_build_object('kind','invalid_request');
  end if;
  if p_after is not null then
    select * into cursor_row from radio_v2.history_cursors where token = p_after;
    if not found then return jsonb_build_object('kind','cursor_expired'); end if;
    if cursor_row.principal <> p_principal or cursor_row.client is distinct from p_client
       or cursor_row.revision <> a.revision or cursor_row.scope <> p_scope then
      return jsonb_build_object('kind','cursor_invalid');
    end if;
    if cursor_row.expires <= now_at then return jsonb_build_object('kind','cursor_expired'); end if;
    if cursor_row.position_xid is null then
      floor_snapshot := cursor_row.ceiling;
    else
      floor_snapshot := cursor_row.previous;
      window_snapshot := cursor_row.ceiling;
      last_xid := cursor_row.position_xid;
      last_id := cursor_row.position_id;
      deadline := cursor_row.expires;
    end if;
  end if;
  window_snapshot := coalesce(window_snapshot, pg_current_snapshot());

  for row_item in
    select r.written, r.id, r.receipt from radio_v2.receipts r
    where r.written >= coalesce(last_xid, pg_snapshot_xmin(floor_snapshot), '0'::xid8)
      and r.written < pg_snapshot_xmax(window_snapshot)
      and (last_xid is null or (r.written,r.id) > (last_xid,last_id))
      and pg_visible_in_snapshot(r.written,window_snapshot)
      and (floor_snapshot is null or not pg_visible_in_snapshot(r.written,floor_snapshot))
    order by r.written,r.id limit page_limit + 1
  loop
    if cardinality(entries) = page_limit or size_bytes + octet_length(row_item.receipt) > 1048576 then
      has_more := true;
      exit;
    end if;
    entries := array_append(entries,row_item.receipt);
    size_bytes := size_bytes + octet_length(row_item.receipt);
    last_xid := row_item.written;
    last_id := row_item.id;
  end loop;

  -- Cursors contain database-local state, not an ongoing transaction or lease.
  -- Clean expired entries in bounded batches as new pages are requested.
  delete from radio_v2.history_cursors where token in (
    select token from radio_v2.history_cursors where expires <= now_at
    order by expires limit 128
  );
  insert into radio_v2.history_cursors(principal,client,revision,scope,previous,ceiling,position_xid,position_id,expires)
  values (p_principal,p_client,a.revision,p_scope,case when has_more then floor_snapshot end,window_snapshot,
    case when has_more then last_xid end,case when has_more then last_id end,
    case when has_more then deadline else now_at + interval '24 hours' end)
  returning token into new_token;
  return jsonb_build_object('items',entries,'next',case when has_more then new_token end,
    'checkpoint',case when not has_more then new_token end);
end $$;

revoke execute on function public.radio_v2_history(uuid,uuid,radio_v2.address,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.radio_v2_history(uuid,uuid,radio_v2.address,uuid,integer) to service_role;
