-- Operator-owned audience assignments for OAuth clients dedicated to one resource.
create table radio_v2.oauth_resources (
  client uuid primary key,
  resource text not null check (length(resource) between 1 and 2048)
);
alter table radio_v2.oauth_resources enable row level security;
revoke all on radio_v2.oauth_resources from public, anon, authenticated, service_role;
grant usage on schema public, radio_v2 to supabase_auth_admin;
grant select on radio_v2.oauth_resources to supabase_auth_admin;
create policy oauth_resource_lookup on radio_v2.oauth_resources
  for select to supabase_auth_admin using (true);

-- Enable this native Auth hook explicitly after assigning dedicated clients.
-- Preserve all other claims and leave ordinary Auth sessions untouched.
create function public.radio_v2_oauth_audience(event jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce((
    select jsonb_set(event, '{claims,aud}', to_jsonb(resource))
    from radio_v2.oauth_resources
    where client = case
      when (event #>> '{claims,client_id}') ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
      then (event #>> '{claims,client_id}')::uuid
    end
  ), event)
$$;
revoke execute on function public.radio_v2_oauth_audience(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.radio_v2_oauth_audience(jsonb) to supabase_auth_admin;

-- Select one validated package revision for each discoverable law. The
-- canonical manifest and encoded SKILL.md bytes are projected from the ZIP.
create table radio_v2.diplomacy (
  law radio_v2.address primary key references radio_v2.laws(hash),
  id radio_v2.address not null,
  manifest text not null check (octet_length(manifest) between 1 and 65536),
  skills jsonb not null check (jsonb_typeof(skills) = 'object'),
  check (id = radio_v2.digest(manifest)),
  check ((manifest::jsonb #>> '{files,process-type.json}') is not distinct from law)
);
alter table radio_v2.diplomacy enable row level security;
revoke all on radio_v2.diplomacy from public, anon, authenticated, service_role;
grant select on radio_v2.diplomacy to service_role;

create function public.radio_v2_mcp_catalog(p_principal uuid, p_client uuid,
  p_registry radio_v2.address, p_after text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  a radio_v2.authority;
  selected radio_v2.address;
begin
  select * into a from radio_v2.authority where principal = p_principal for share;
  if not radio_v2.permitted(a, p_client, 'read_public') then
    return jsonb_build_object('kind', 'forbidden');
  end if;
  selected := coalesce(p_registry, (select hash from radio_v2.registry_head where singleton));
  if not exists (select from radio_v2.registries where hash = selected) then
    return jsonb_build_object('kind', 'not_found');
  end if;
  return (
    with page as (
      select l.id, l.hash from radio_v2.registries s
      cross join lateral unnest(s.laws) as active(hash)
      join radio_v2.laws l on l.hash = active.hash
      where s.hash = selected and (p_after is null or l.id > p_after)
      order by l.id limit 51
    )
    select jsonb_build_object('registry', selected,
      'items', coalesce(jsonb_agg(jsonb_build_object('id', id, 'hash', hash) order by id), '[]'::jsonb))
    from page
  );
end $$;

create function public.radio_v2_mcp_law(p_principal uuid, p_client uuid,
  p_law radio_v2.address, p_skill text)
returns jsonb language plpgsql set search_path = '' as $$
declare a radio_v2.authority;
begin
  select * into a from radio_v2.authority where principal = p_principal for share;
  if not radio_v2.permitted(a, p_client, 'read_public') then
    return jsonb_build_object('kind', 'forbidden');
  end if;
  if p_skill is null then
    return (select jsonb_build_object('law', o.body, 'diplomacy', d.id)
      from radio_v2.laws l join radio_v2.objects o on o.hash = l.hash
      left join radio_v2.diplomacy d on d.law = l.hash where l.hash = p_law);
  end if;
  if p_skill = '' then
    return (select jsonb_build_object('id', d.id, 'manifest', d.manifest, 'skills', (
      select coalesce(jsonb_agg(jsonb_build_object('name', key, 'description', value->'description') order by key),
        '[]'::jsonb)
      from jsonb_each(d.skills)
    )) from radio_v2.diplomacy d where d.law = p_law);
  end if;
  return (select jsonb_build_object('id', d.id, 'manifest', d.manifest, 'skill', d.skills -> p_skill)
    from radio_v2.diplomacy d where d.law = p_law and d.skills ? p_skill);
end $$;

revoke execute on function public.radio_v2_mcp_catalog(uuid,uuid,radio_v2.address,text),
  public.radio_v2_mcp_law(uuid,uuid,radio_v2.address,text)
  from public, anon, authenticated, service_role;
grant execute on function public.radio_v2_mcp_catalog(uuid,uuid,radio_v2.address,text),
  public.radio_v2_mcp_law(uuid,uuid,radio_v2.address,text)
  to service_role;
