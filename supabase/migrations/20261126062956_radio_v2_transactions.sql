-- RADIO 1.0 transaction boundary. The preview's v1 tables and RPCs retain
-- their own contract. Only the trusted v2 evaluator adapter calls these RPCs.
create schema radio_v2;
revoke all on schema radio_v2 from public, anon, authenticated, service_role;
grant usage on schema radio_v2 to service_role;

create domain radio_v2.address as text collate "C"
  check (value ~ '^sha256:[0-9a-f]{64}$');
create domain radio_v2.run_name as text collate "C"
  check (value ~ '^[A-Za-z0-9_-]{1,64}$');

create function radio_v2.digest(body text) returns radio_v2.address
language sql immutable strict set search_path = '' as $$
  select ('sha256:' || encode(sha256(convert_to(body, 'UTF8')), 'hex'))::radio_v2.address
$$;

-- Every normative object remains canonical UTF-8 text. Typed projections are
-- supplied by the trusted adapter from the same verified evaluation result.
create table radio_v2.objects (
  hash radio_v2.address primary key,
  body text not null check (octet_length(body) between 1 and 1048576),
  check (hash = radio_v2.digest(body))
);
create table radio_v2.laws (
  id text collate "C" primary key check (id ~ '^[a-z0-9][a-z0-9._:@-]{0,127}$'),
  hash radio_v2.address not null unique references radio_v2.objects
);
create table radio_v2.registries (
  hash radio_v2.address primary key references radio_v2.objects,
  laws radio_v2.address[] not null check (cardinality(laws) <= 4096),
  scan_ops integer not null check (scan_ops between 1 and 1000000)
);
create table radio_v2.registry_head (
  singleton boolean primary key default true check (singleton),
  hash radio_v2.address not null references radio_v2.registries
);
create table radio_v2.receipts (
  id radio_v2.address primary key,
  receipt text not null check (octet_length(receipt) between 1 and 245760)
);
create table radio_v2.authority (
  principal uuid primary key,
  pseudonym text collate "C" not null unique check (length(pseudonym) between 1 and 256),
  revision bigint not null default 1 check (revision > 0),
  active boolean not null default false,
  -- Resource permissions are keyed by receipt address. Mandates are keyed
  -- by the verified OAuth client UUID or the explicitly allowed direct session.
  permissions text[] not null default '{}',
  mandates jsonb not null default '{}' check (jsonb_typeof(mandates) = 'object'),
  evidence jsonb not null default '{}' check (jsonb_typeof(evidence) = 'object')
);
create table radio_v2.decisions (
  receipt_id radio_v2.address primary key references radio_v2.receipts,
  principal uuid not null references radio_v2.authority,
  client uuid,
  authority_revision bigint not null,
  submission text collate "C" not null check (submission ~ '^[A-Za-z0-9_-]{22,128}$'),
  request_hash radio_v2.address not null,
  admission_registry radio_v2.address not null references radio_v2.registries,
  registry_hash radio_v2.address not null references radio_v2.registries,
  law_hash radio_v2.address references radio_v2.laws(hash),
  run radio_v2.run_name,
  instance radio_v2.address references radio_v2.receipts,
  status text not null check (status in ('registered', 'ok', 'not', 'doubt')),
  tuple_hash radio_v2.address not null references radio_v2.objects,
  detail_hash radio_v2.address not null references radio_v2.objects,
  context_hash radio_v2.address not null references radio_v2.objects,
  unique (principal, submission),
  check (status <> 'ok' or (run is not null and law_hash is not null))
);
create table radio_v2.successful_runs (
  instance radio_v2.address references radio_v2.receipts,
  run radio_v2.run_name,
  receipt_id radio_v2.address not null references radio_v2.decisions,
  primary key (instance, run)
);
create table radio_v2.consumptions (
  law radio_v2.address references radio_v2.laws(hash),
  slot text collate "C" check (length(slot) between 1 and 128),
  cited radio_v2.address references radio_v2.receipts,
  receipt_id radio_v2.address not null references radio_v2.decisions,
  primary key (law, slot, cited)
);
create table radio_v2.publication_audit (
  id bigint generated always as identity primary key,
  principal uuid not null references radio_v2.authority,
  client uuid,
  authority_revision bigint not null,
  operation text not null check (operation in ('publish', 'retire')),
  law radio_v2.address not null references radio_v2.laws(hash),
  registry_hash radio_v2.address not null references radio_v2.registries
);

create function radio_v2.revise_authority() returns trigger
language plpgsql set search_path = '' as $$ begin
  if new.principal is distinct from old.principal or new.pseudonym is distinct from old.pseudonym then
    raise exception 'immutable institutional identity';
  end if;
  new.revision := old.revision + 1;
  return new;
end $$;
create trigger authority_revision before update on radio_v2.authority
  for each row execute function radio_v2.revise_authority();

create trigger objects_immutable before update or delete on radio_v2.objects
  for each row execute function public.logline_immutable();
create trigger laws_immutable before update or delete on radio_v2.laws
  for each row execute function public.logline_immutable();
create trigger registries_immutable before update or delete on radio_v2.registries
  for each row execute function public.logline_immutable();
create trigger receipts_immutable before update or delete on radio_v2.receipts
  for each row execute function public.logline_immutable();
create trigger decisions_immutable before update or delete on radio_v2.decisions
  for each row execute function public.logline_immutable();
create trigger successful_runs_immutable before update or delete on radio_v2.successful_runs
  for each row execute function public.logline_immutable();
create trigger consumptions_immutable before update or delete on radio_v2.consumptions
  for each row execute function public.logline_immutable();
create trigger publication_audit_immutable before update or delete on radio_v2.publication_audit
  for each row execute function public.logline_immutable();

create function radio_v2.put(p_hash radio_v2.address, p_body text) returns void
language plpgsql set search_path = '' as $$ begin
  insert into radio_v2.objects(hash, body) values (p_hash, p_body) on conflict (hash) do nothing;
  if not exists (select from radio_v2.objects where hash = p_hash and body collate "C" = p_body) then
    raise exception 'CAS address collision';
  end if;
end $$;

create function radio_v2.save_registry(p_laws radio_v2.address[], p_ops integer)
returns radio_v2.address language plpgsql set search_path = '' as $$
declare
  body text := '{"logline":"registry@1","scan_ops":' || p_ops ||
    ',"types":[' || coalesce((select string_agg('"' || law || '"', ',' order by law)
      from unnest(p_laws) as active(law)), '') || ']}';
  id radio_v2.address;
begin
  -- Only sorted, validated ASCII content addresses and the integer budget
  -- are assembled here. This is the fixed Registry shape from the kernel.
  id := radio_v2.digest(body);
  perform radio_v2.put(id, body);
  insert into radio_v2.registries values (id, p_laws, p_ops) on conflict (hash) do nothing;
  return id;
end $$;
insert into radio_v2.registry_head(hash) values (radio_v2.save_registry('{}', 1000000));

create function radio_v2.permitted(a radio_v2.authority, p_client uuid, operation text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(a.active and operation = any(a.permissions)
    and jsonb_typeof(a.mandates -> coalesce(p_client::text, 'direct')) = 'array'
    and (a.mandates -> coalesce(p_client::text, 'direct')) ? operation, false)
$$;
create function radio_v2.may_use(a radio_v2.authority, p_client uuid, p_id radio_v2.address, operation text)
returns boolean language sql stable set search_path = '' as $$
  select radio_v2.permitted(a, p_client, operation) and exists (
    select from radio_v2.decisions d where d.receipt_id = p_id
    and (d.principal = a.principal or (jsonb_typeof(a.evidence -> p_id::text) = 'array'
      and (a.evidence -> p_id::text) ? operation))
  )
$$;
create function radio_v2.result(p_id radio_v2.address) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('receipt', r.receipt, 'detail', de.body, 'context', cx.body)
  from radio_v2.receipts r join radio_v2.decisions d on d.receipt_id = r.id
  join radio_v2.objects de on de.hash = d.detail_hash
  join radio_v2.objects cx on cx.hash = d.context_hash
  where r.id = p_id
$$;

create function public.radio_v2_publish(p_principal uuid, p_client uuid, p_id text,
  p_hash radio_v2.address, p_body text) returns jsonb
language plpgsql set search_path = '' as $$
declare
  a radio_v2.authority;
  head radio_v2.registries;
  old_hash radio_v2.address;
  next_hash radio_v2.address;
  law_bytes integer := octet_length(p_body);
begin
  select * into a from radio_v2.authority where principal = p_principal for share;
  if not radio_v2.permitted(a, p_client, case when p_body is null then 'retire' else 'publish' end) then
    return jsonb_build_object('kind', 'forbidden');
  end if;
  -- Serialize publications and retirements on the single mutable pointer.
  select hash into next_hash from radio_v2.registry_head where singleton for update;
  select * into strict head from radio_v2.registries where hash = next_hash;
  select hash into old_hash from radio_v2.laws where id = p_id;
  if p_body is null then
    if old_hash is null then return jsonb_build_object('kind', 'not_found'); end if;
    if not (old_hash = any(head.laws)) then
      return jsonb_build_object('kind', 'replayed', 'hash', old_hash, 'registry', head.hash);
    end if;
    next_hash := radio_v2.save_registry(array_remove(head.laws, old_hash), head.scan_ops);
  else
    if law_bytes not between 1 and 65536 then return jsonb_build_object('kind', 'resource_limit'); end if;
    if p_hash is distinct from radio_v2.digest(p_body) then raise exception 'law address mismatch'; end if;
    if old_hash is not null then
      if old_hash <> p_hash then return jsonb_build_object('kind', 'publication_conflict'); end if;
      perform radio_v2.put(p_hash, p_body);
      return jsonb_build_object('kind', 'replayed', 'hash', p_hash, 'registry', head.hash);
    end if;
    if cardinality(head.laws) >= 4096 or law_bytes + (
      select coalesce(sum(octet_length(body)),0) from radio_v2.objects where hash = any(head.laws)
    ) > 16777216 then
      return jsonb_build_object('kind', 'resource_limit');
    end if;
    perform radio_v2.put(p_hash, p_body);
    insert into radio_v2.laws values (p_id, p_hash);
    next_hash := radio_v2.save_registry(array(
      select law from unnest(head.laws || p_hash) as active(law) order by law
    ), head.scan_ops);
  end if;
  update radio_v2.registry_head set hash = next_hash where singleton;
  insert into radio_v2.publication_audit(principal,client,authority_revision,operation,law,registry_hash)
    values (a.principal,p_client,a.revision,case when p_body is null then 'retire' else 'publish' end,
            coalesce(old_hash,p_hash),next_hash);
  return jsonb_build_object('kind', 'committed', 'hash', coalesce(old_hash,p_hash), 'registry', next_hash);
end $$;

create function radio_v2.prior(a radio_v2.authority, p_submission text, p_request_hash radio_v2.address)
returns jsonb language sql stable set search_path = '' as $$
  select case when d.request_hash <> p_request_hash then jsonb_build_object('kind', 'submission_conflict')
         else jsonb_build_object('kind', 'replayed', 'id', d.receipt_id, 'result', radio_v2.result(d.receipt_id)) end
  from radio_v2.decisions d where d.principal = a.principal and d.submission = p_submission
$$;

create function public.radio_v2_admit(p_principal uuid, p_client uuid, p_submission text, p_request_hash radio_v2.address)
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
  return coalesce(radio_v2.prior(a,p_submission,p_request_hash), (
    select jsonb_build_object('kind','admitted','by',a.pseudonym,'revision',a.revision::text,
      'registry',hash,'when',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    from radio_v2.registry_head where singleton
  ));
end $$;

create function public.radio_v2_registry(p_principal uuid, p_client uuid, p_hash radio_v2.address,
  p_evaluate boolean) returns jsonb language plpgsql set search_path = '' as $$
declare a radio_v2.authority;
begin
  select * into a from radio_v2.authority where principal = p_principal for share;
  if not ((p_evaluate is true and radio_v2.permitted(a,p_client,'submit') and radio_v2.permitted(a,p_client,'disclose'))
    or (p_evaluate is false and radio_v2.permitted(a,p_client,'read_public'))) then return null; end if;
  return (
    select jsonb_build_object('hash',s.hash,'snapshot',o.body,'laws',coalesce((
      select jsonb_object_agg(law.hash,law.body) from radio_v2.objects law where law.hash = any(s.laws)
    ),'{}'::jsonb))
    from radio_v2.registries s join radio_v2.objects o on o.hash = s.hash
    where s.hash = coalesce(p_hash,(select hash from radio_v2.registry_head where singleton))
  );
end $$;

create function public.radio_v2_read(p_principal uuid, p_client uuid, p_id radio_v2.address, p_mode text)
returns jsonb language plpgsql set search_path = '' as $$
declare a radio_v2.authority;
begin
  select * into a from radio_v2.authority where principal = p_principal for share;
  if p_mode = 'public' and radio_v2.permitted(a,p_client,'read_public') then
    return (select jsonb_build_object('receipt',receipt) from radio_v2.receipts where id = p_id);
  elsif p_mode = 'use' and radio_v2.may_use(a,p_client,p_id,'use_evidence') then
    return (
      select jsonb_build_object('receipt',r.receipt,'detail',o.body)
      from radio_v2.receipts r join radio_v2.decisions d on d.receipt_id = r.id
      join radio_v2.objects o on o.hash = d.detail_hash where r.id = p_id
    );
  elsif p_mode = 'disclose' and radio_v2.may_use(a,p_client,p_id,'disclose') then
    return radio_v2.result(p_id) || (select jsonb_build_object('tuple',o.body)
      from radio_v2.decisions d join radio_v2.objects o on o.hash = d.tuple_hash where d.receipt_id = p_id);
  end if;
  return null;
end $$;

create function public.radio_v2_observe(p_principal uuid, p_client uuid, p_key radio_v2.address,
  p_role text, p_cited radio_v2.address) returns jsonb language plpgsql set search_path = '' as $$
declare a radio_v2.authority;
begin
  select * into a from radio_v2.authority where principal = p_principal for share;
  if not (radio_v2.permitted(a,p_client,'submit') and radio_v2.permitted(a,p_client,'disclose')
    and radio_v2.may_use(a,p_client,coalesce(p_cited,p_key),'use_evidence')) then return null; end if;
  if p_cited is null then
    -- Completion conflict evidence is available to the machine for this
    -- admitted root, independently of permission to disclose the winner.
    return (
      select jsonb_build_object('id',s.receipt_id,'receipt',r.receipt,'detail',o.body)
      from radio_v2.successful_runs s join radio_v2.decisions d on d.receipt_id = s.receipt_id
      join radio_v2.receipts r on r.id = d.receipt_id join radio_v2.objects o on o.hash = d.detail_hash
      where s.instance = p_key and s.run = p_role
    );
  end if;
  return to_jsonb(exists (select from radio_v2.consumptions
    where law = p_key and slot = p_role and cited = p_cited));
end $$;

create function public.radio_v2_commit(p_principal uuid, p_client uuid, p jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  a radio_v2.authority;
  rid radio_v2.address := p->>'id';
  nonce text := p->>'submission';
  requested radio_v2.address := p->>'request_hash';
  admitted radio_v2.address := p->>'admission_registry';
  registry radio_v2.address := p->>'registry';
  selected_law radio_v2.address := p->>'law';
  current_run radio_v2.run_name := p->>'run';
  root radio_v2.address := p->>'instance';
  winner radio_v2.address := p->>'completed';
  outcome text := p->>'status';
  signing_key radio_v2.address := p->>'key';
  signature text := p->>'signature';
  signed_header text := p->>'header';
  envelope text;
  receipt_reads jsonb := p->'reads';
  once_reads jsonb := p->'once';
  prior jsonb;
  item record;
begin
  select * into a from radio_v2.authority where principal = p_principal for share;
  if not (radio_v2.permitted(a,p_client,'submit') and radio_v2.permitted(a,p_client,'disclose')) then
    return jsonb_build_object('kind','forbidden');
  end if;
  if requested is null or nonce is null or nonce !~ '^[A-Za-z0-9_-]{22,128}$' then
    return jsonb_build_object('kind','invalid_request');
  end if;

  -- Recovery needs only the principal, nonce and request hash. Never return
  -- old evidence before checking current operation and disclosure authority.
  perform pg_advisory_xact_lock(hashtextextended('radio-v2:submission:' || p_principal || ':' || nonce, 0));
  prior := radio_v2.prior(a,nonce,requested);
  if prior is not null then return prior; end if;
  if (p->>'revision')::bigint is distinct from a.revision then return jsonb_build_object('kind','retry'); end if;

  if rid is null or admitted is null or registry is null
     or signing_key is null or signature is null or signature !~ '^[A-Za-z0-9_-]{86}$'
     or signed_header is null or p->>'by' is distinct from a.pseudonym
     or outcome is null or outcome not in ('registered','ok','not','doubt')
     or (outcome = 'ok' and (selected_law is null or current_run is null))
     or jsonb_typeof(receipt_reads) is distinct from 'object'
     or jsonb_typeof(once_reads) is distinct from 'array'
     or jsonb_typeof(p->'prev') is distinct from 'array' then
    return jsonb_build_object('kind','invalid_request');
  end if;
  if octet_length(signed_header) > 245760 or octet_length(p->>'tuple') > 65536
     or octet_length(p->>'detail') > 1048576 or octet_length(p->>'context') > 1048576
     or (select count(*) from jsonb_object_keys(receipt_reads)) > 82
     or jsonb_array_length(once_reads) > 16 or jsonb_array_length(p->'prev') > 81 then
    return jsonb_build_object('kind','resource_limit');
  end if;
  if rid <> radio_v2.digest(signed_header) then raise exception 'receipt address mismatch'; end if;
  envelope := '{"header":' || signed_header || ',"id":"' || rid ||
    '","sig":{"alg":"Ed25519","key":"' || signing_key || '","value":"' || signature || '"}}';
  if octet_length(envelope) > 245760 then return jsonb_build_object('kind','resource_limit'); end if;

  if (root is null and (registry <> admitted or p ? 'completed'))
     or (root is not null and (selected_law is null
         or receipt_reads -> root::text is distinct from 'true'::jsonb
         or not exists (select from radio_v2.decisions d where d.receipt_id = root
           and d.instance is null and d.status = 'ok' and d.law_hash = selected_law and d.registry_hash = registry)))
     or (p ? 'completed' and (root is null or current_run is null))
     or (outcome = 'ok' and root is not null and (not (p ? 'completed') or winner is not null))
     or (selected_law is not null and not exists
       (select from radio_v2.registries s where s.hash = registry and selected_law = any(s.laws)))
     or exists (select from jsonb_each(receipt_reads) as e(id,visible)
       where id !~ '^sha256:[0-9a-f]{64}$' or jsonb_typeof(visible) <> 'boolean')
     or exists (select from jsonb_array_elements_text(p->'prev') as e(id)
       where receipt_reads -> id is distinct from 'true'::jsonb)
     or exists (select from jsonb_to_recordset(once_reads) as c(slot text, cited text, spent boolean)
       where selected_law is null or c.slot is null or length(c.slot) not between 1 and 128
          or c.cited is null or c.cited !~ '^sha256:[0-9a-f]{64}$'
          or c.spent is null or (c.spent and outcome = 'ok')
          or receipt_reads -> c.cited is distinct from 'true'::jsonb)
     or exists (select from jsonb_to_recordset(once_reads) as c(slot text)
       group by c.slot having count(*) > 1) then
    return jsonb_build_object('kind','invalid_request');
  end if;

  -- A missing receipt or claim can become present. Protect absence too,
  -- including for registered/not/doubt candidates which acquire no claims.
  -- Independent submissions lock only addresses and claims they observed.
  for item in
    with keys(label, writes) as (
      select 'receipt:' || rid, true
      union all select 'receipt:' || id,false from jsonb_object_keys(receipt_reads) as e(id)
      union all select 'run:' || coalesce(root,rid) || ':' || current_run,outcome = 'ok'
        where outcome = 'ok' or p ? 'completed'
      union all select 'once:' || selected_law || ':' || c.slot || ':' || c.cited,outcome = 'ok'
        from jsonb_to_recordset(once_reads) as c(slot text, cited text)
    )
    select hashtextextended('radio-v2:observation:' || label,0) as key, bool_or(writes) as writes
    from keys group by 1 order by 1
  loop
    if item.writes then perform pg_advisory_xact_lock(item.key);
    else perform pg_advisory_xact_lock_shared(item.key); end if;
  end loop;

  if (p ? 'completed' and winner is distinct from
        (select receipt_id from radio_v2.successful_runs where instance = root and run = current_run))
     or exists (select from jsonb_each_text(receipt_reads) as e(id,visible)
       where visible::boolean is distinct from (
         (winner is not null and e.id = winner) or radio_v2.may_use(a,p_client,e.id::radio_v2.address,'use_evidence')))
     or exists (select from jsonb_to_recordset(once_reads) as c(slot text, cited radio_v2.address, spent boolean)
       where c.spent is distinct from exists (select from radio_v2.consumptions x
         where x.law = selected_law and x.slot = c.slot and x.cited = c.cited)) then
    return jsonb_build_object('kind','retry');
  end if;

  -- The admitted snapshot and original root law stay pinned across retries.
  -- Never consult the mutable Registry head while constituting the result.
  begin
    for item in select * from (values (p->>'tuple_hash',p->>'tuple'),
       (p->>'detail_hash',p->>'detail'), (p->>'context_hash',p->>'context')) as parts(hash,body)
       order by hash collate "C"
    loop
      perform radio_v2.put(item.hash::radio_v2.address,item.body);
    end loop;
    insert into radio_v2.receipts values (rid,envelope);
    insert into radio_v2.decisions(receipt_id,principal,client,authority_revision,submission,request_hash,
      admission_registry,registry_hash,law_hash,run,instance,status,tuple_hash,detail_hash,context_hash)
    values (rid,p_principal,p_client,a.revision,nonce,requested,admitted,registry,selected_law,current_run,root,outcome,
      p->>'tuple_hash',p->>'detail_hash',p->>'context_hash');

    if outcome = 'ok' then
      insert into radio_v2.successful_runs values (coalesce(root,rid),current_run,rid) on conflict do nothing;
      if not found then raise exception using errcode = 'RA001', message = 'RUN claim changed'; end if;
      for item in select * from jsonb_to_recordset(once_reads) as c(slot text, cited radio_v2.address)
        order by slot collate "C",cited
      loop
        insert into radio_v2.consumptions values (selected_law,item.slot,item.cited,rid) on conflict do nothing;
        if not found then raise exception using errcode = 'RA001', message = 'once claim changed'; end if;
      end loop;
    end if;
  exception when sqlstate 'RA001' then
    return jsonb_build_object('kind','retry');
  end;
  return jsonb_build_object('kind','committed','id',rid);
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array['objects','laws','registries','registry_head','receipts',
    'authority','decisions','successful_runs','consumptions','publication_audit']
  loop
    execute format('alter table radio_v2.%I enable row level security', table_name);
  end loop;
end $$;

revoke all on all tables in schema radio_v2 from public, anon, authenticated, service_role;
revoke all on all sequences in schema radio_v2 from public, anon, authenticated, service_role;
revoke execute on all functions in schema radio_v2 from public, anon, authenticated, service_role;

grant select on all tables in schema radio_v2 to service_role;
grant insert on radio_v2.objects, radio_v2.laws, radio_v2.registries, radio_v2.receipts,
  radio_v2.decisions, radio_v2.successful_runs, radio_v2.consumptions, radio_v2.publication_audit to service_role;
grant update (hash) on radio_v2.registry_head to service_role;
-- PostgreSQL row locks require an UPDATE grant. The service role holds only
-- the revision column privilege for this table, while grants stay operator-owned.
grant update (revision) on radio_v2.authority to service_role;
grant usage on sequence radio_v2.publication_audit_id_seq to service_role;
grant execute on all functions in schema radio_v2 to service_role;

revoke execute on function
  public.radio_v2_publish(uuid,uuid,text,radio_v2.address,text),
  public.radio_v2_admit(uuid,uuid,text,radio_v2.address),
  public.radio_v2_registry(uuid,uuid,radio_v2.address,boolean),
  public.radio_v2_read(uuid,uuid,radio_v2.address,text),
  public.radio_v2_observe(uuid,uuid,radio_v2.address,text,radio_v2.address),
  public.radio_v2_commit(uuid,uuid,jsonb)
from public, anon, authenticated, service_role;
grant execute on function
  public.radio_v2_publish(uuid,uuid,text,radio_v2.address,text),
  public.radio_v2_admit(uuid,uuid,text,radio_v2.address),
  public.radio_v2_registry(uuid,uuid,radio_v2.address,boolean),
  public.radio_v2_read(uuid,uuid,radio_v2.address,text),
  public.radio_v2_observe(uuid,uuid,radio_v2.address,text,radio_v2.address),
  public.radio_v2_commit(uuid,uuid,jsonb)
to service_role;
