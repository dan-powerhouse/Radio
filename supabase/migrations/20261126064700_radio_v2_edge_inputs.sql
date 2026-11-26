-- Keep continuations from fetching the full active or historical Registry.
-- The existing bulk RPC remains available to the hosted transaction harness.
create function public.radio_v2_registry_inputs(p_principal uuid, p_client uuid, p_hash radio_v2.address,
  p_selection text) returns jsonb language plpgsql set search_path = '' as $$
declare a radio_v2.authority;
begin
  select * into a from radio_v2.authority where principal = p_principal for share;
  if not (radio_v2.permitted(a,p_client,'submit') and radio_v2.permitted(a,p_client,'disclose')) then return null; end if;
  return (
    select jsonb_build_object('hash',s.hash,'snapshot',o.body,'laws',coalesce((
      select jsonb_object_agg(law.hash,law.body) from radio_v2.objects law
      where law.hash = any(s.laws) and (p_selection = 'all' or law.hash = p_selection)
    ),'{}'::jsonb))
    from radio_v2.registries s join radio_v2.objects o on o.hash = s.hash
    where s.hash = p_hash
  );
end $$;
revoke execute on function public.radio_v2_registry_inputs(uuid,uuid,radio_v2.address,text)
  from public, anon, authenticated, service_role;
grant execute on function public.radio_v2_registry_inputs(uuid,uuid,radio_v2.address,text) to service_role;

create or replace function public.radio_v2_admit(p_principal uuid, p_client uuid, p_submission text,
  p_request_hash radio_v2.address)
returns jsonb language plpgsql set search_path = '' as $$
declare a radio_v2.authority;
begin
  select * into a from radio_v2.authority where principal = p_principal for share;
  if not (radio_v2.permitted(a,p_client,'submit') and radio_v2.permitted(a,p_client,'disclose')) then
    return jsonb_build_object('kind', 'forbidden');
  end if;
  if p_request_hash is null or p_submission is null or p_submission !~ '^[A-Za-z0-9_-]{22,128}$' then
    return jsonb_build_object('kind', 'invalid_request');
  end if;
  -- Recovery waits for a commit already holding this submission's lock.
  -- The lock ends at this RPC, before the machine evaluates.
  perform pg_advisory_xact_lock(hashtextextended('radio-v2:submission:' || p_principal || ':' || p_submission, 0));
  return coalesce(radio_v2.prior(a,p_submission,p_request_hash), (
    select jsonb_build_object('kind','admitted','by',a.pseudonym,'revision',a.revision::text,
      'registry',hash,'when',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    from radio_v2.registry_head where singleton
  ));
end $$;
