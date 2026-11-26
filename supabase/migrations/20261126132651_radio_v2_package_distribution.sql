-- Keep the first verified archive for a package ID. The adopted-Skill
-- pointer may move while the exact archive and its law association persist.
create table radio_v2.package_archives (
  id radio_v2.address primary key,
  law radio_v2.address not null references radio_v2.laws(hash),
  manifest text not null check (octet_length(manifest) between 1 and 65536),
  archive_hash radio_v2.address not null,
  archive bytea not null check (octet_length(archive) between 1 and 8388608),
  check (id = radio_v2.digest(manifest)),
  check ((manifest::jsonb #>> '{files,process-type.json}') is not distinct from law),
  check (archive_hash = ('sha256:' || encode(sha256(archive), 'hex'))::radio_v2.address)
);
create table radio_v2.package_adoptions (
  id bigint generated always as identity primary key,
  package radio_v2.address not null references radio_v2.package_archives,
  principal uuid not null references radio_v2.authority,
  client uuid,
  authority_revision bigint not null
);
alter table radio_v2.package_archives enable row level security;
alter table radio_v2.package_adoptions enable row level security;
create trigger package_archives_immutable before update or delete on radio_v2.package_archives
  for each row execute function public.logline_immutable();
create trigger package_adoptions_immutable before update or delete on radio_v2.package_adoptions
  for each row execute function public.logline_immutable();
revoke all on radio_v2.package_archives,radio_v2.package_adoptions from public,anon,authenticated,service_role;
grant select,insert on radio_v2.package_archives to service_role;
grant insert on radio_v2.package_adoptions to service_role;
grant insert,update on radio_v2.diplomacy to service_role;

create function public.radio_v2_adopt_package(p_principal uuid, p_client uuid,
  p_law radio_v2.address, p_id radio_v2.address, p_manifest text, p_skills jsonb,
  p_hash radio_v2.address, p_archive bytea) returns jsonb
language plpgsql set search_path = '' as $$
declare a radio_v2.authority;
begin
  select * into a from radio_v2.authority where principal = p_principal for share;
  if not radio_v2.permitted(a,p_client,'distribute_package') then return jsonb_build_object('kind','forbidden'); end if;
  if not exists (select from radio_v2.laws where hash = p_law) then return jsonb_build_object('kind','not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended('radio-v2:package:' || p_law,0));
  if octet_length(p_archive) > 8388608 then return jsonb_build_object('kind','resource_limit'); end if;
  insert into radio_v2.package_archives(id,law,manifest,archive_hash,archive)
    values (p_id,p_law,p_manifest,p_hash,p_archive) on conflict (id) do nothing;
  if not exists (select from radio_v2.package_archives
    where id=p_id and law=p_law and manifest=p_manifest and archive_hash=p_hash and archive=p_archive) then
    return jsonb_build_object('kind','invalid_request');
  end if;
  insert into radio_v2.diplomacy(law,id,manifest,skills) values (p_law,p_id,p_manifest,p_skills)
    on conflict (law) do update set id=excluded.id,manifest=excluded.manifest,skills=excluded.skills
    where (diplomacy.id,diplomacy.manifest,diplomacy.skills) is distinct from (excluded.id,excluded.manifest,excluded.skills);
  if not found then return jsonb_build_object('kind','replayed','id',p_id); end if;
  insert into radio_v2.package_adoptions(package,principal,client,authority_revision)
    values (p_id,p_principal,p_client,a.revision);
  return jsonb_build_object('kind','committed','id',p_id);
end $$;

create function public.radio_v2_package(p_principal uuid, p_client uuid, p_id radio_v2.address) returns jsonb
language plpgsql set search_path = '' as $$
declare a radio_v2.authority;
begin
  select * into a from radio_v2.authority where principal = p_principal for share;
  if not radio_v2.permitted(a,p_client,'read_public') then return null; end if;
  return (select jsonb_build_object('id',id,'hash',archive_hash,'archive',encode(archive,'base64'))
    from radio_v2.package_archives where id = p_id);
end $$;

revoke execute on function public.radio_v2_adopt_package(uuid,uuid,radio_v2.address,radio_v2.address,text,jsonb,radio_v2.address,bytea),
  public.radio_v2_package(uuid,uuid,radio_v2.address) from public,anon,authenticated,service_role;
grant execute on function public.radio_v2_adopt_package(uuid,uuid,radio_v2.address,radio_v2.address,text,jsonb,radio_v2.address,bytea),
  public.radio_v2_package(uuid,uuid,radio_v2.address) to service_role;
