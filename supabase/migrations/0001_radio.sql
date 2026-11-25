-- Unapplied replacement of the original draft. Only the trusted Edge adapter writes.
-- Canonical JSON is text: jsonb cannot represent all I-JSON (e.g. escaped U+0000).
create table public.objects (
  hash text primary key check (hash ~ '^sha256:[0-9a-f]{64}$'),
  body text not null
);
create table public.processes (
  id text primary key,
  hash text not null unique references public.objects(hash)
);
-- Every column here is public, including when replicated by Realtime.
create table public.receipts (
  id text primary key check (id ~ '^sha256:[0-9a-f]{64}$'),
  seq bigint generated always as identity unique,
  frequency text not null,
  status text not null check (status in ('registered','ok','doubt','not')),
  by text,
  process_hash text references public.objects(hash),
  activated boolean not null,
  receipt text not null
);
create index receipts_frequency_seq on public.receipts (frequency, seq);
create index receipts_by_seq on public.receipts (by, seq);
-- Access attaches to the receipt, not the CAS hash. Multiple owners may share bytes.
create table public.receipt_access (
  receipt_id text primary key references public.receipts(id),
  owner uuid,
  input_hash text not null references public.objects(hash),
  detail_hash text not null references public.objects(hash)
);
create table public.submissions (
  cache_key text primary key,
  receipt_id text not null references public.receipts(id) deferrable initially deferred
);
create table public.consumptions (
  process_id text not null references public.processes(id),
  slot text not null,
  cited_id text not null references public.receipts(id),
  consumed_by text not null references public.receipts(id),
  primary key (process_id, slot, cited_id)
);
-- Durable event emitted in the same transaction. No network call in the transaction.
create table public.outbox (
  receipt_id text primary key references public.receipts(id),
  created_at timestamptz not null default now(),
  dispatched_at timestamptz
);
-- Reserved for the asynchronous reaction worker, not yet enabled.
create table public.reaction_jobs (
  trigger_id text not null references public.receipts(id),
  process_id text not null references public.processes(id),
  primary key (trigger_id, process_id)
);

create function public.logline_immutable() returns trigger language plpgsql
set search_path = '' as $$ begin raise exception 'immutable table %', tg_table_name; end $$;
create trigger objects_immutable before update or delete on public.objects for each row execute function public.logline_immutable();
create trigger processes_immutable before update or delete on public.processes for each row execute function public.logline_immutable();
create trigger receipts_immutable before update or delete on public.receipts for each row execute function public.logline_immutable();
create trigger access_immutable before update or delete on public.receipt_access for each row execute function public.logline_immutable();
create trigger submissions_immutable before update or delete on public.submissions for each row execute function public.logline_immutable();
create trigger consumptions_immutable before update or delete on public.consumptions for each row execute function public.logline_immutable();

create function public.logline_enqueue() returns trigger language plpgsql
set search_path = '' as $$ begin
  insert into public.outbox(receipt_id) values (new.id);
  return new;
end $$;
create trigger receipt_outbox after insert on public.receipts for each row execute function public.logline_enqueue();

-- CAS writes are idempotent; an existing address must have exactly the same bytes.
create function public.logline_put(h text, b text) returns void language plpgsql
set search_path = '' as $$ begin
  insert into public.objects(hash, body) values (h, b) on conflict (hash) do nothing;
  if not exists (select 1 from public.objects where hash = h and body = b) then
    raise exception 'CAS address collision';
  end if;
end $$;

create function public.logline_publish(p_id text, p_hash text, p_body text) returns void
language plpgsql set search_path = '' as $$ begin
  perform public.logline_put(p_hash, p_body);
  insert into public.processes(id, hash) values (p_id, p_hash);
end $$;

-- Snapshot of already-spent citations. The evaluator remains TypeScript.
create function public.logline_spent(p_process text, p_claims jsonb) returns text[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(distinct c.cited_id order by c.cited_id), '{}')
  from public.consumptions c
  join jsonb_to_recordset(p_claims) as x(slot text, cited_id text)
    on c.slot = x.slot and c.cited_id = x.cited_id
  where c.process_id = p_process;
$$;

-- Commit one already evaluated and signed root. Only the service role can call.
-- Idempotency, once claims, CAS, receipt, owner and outbox are one transaction.
-- A losing once claim rolls back EVERYTHING in this block, then the caller reruns.
create function public.logline_commit(p jsonb) returns jsonb language plpgsql
set search_path = '' as $$
declare
  rid text := p->>'id';
  idem text := p->>'cache_key';
  law text := p->>'process_id';
  law_hash text := p->>'process_hash';
  previous_id text;
  claim record;
  inserted integer;
  old_spent text[];
  expected_spent text[];
begin
  select receipt_id into previous_id from public.submissions where cache_key = idem;
  if found then return jsonb_build_object('kind','replayed','id',previous_id); end if;
  -- If publication raced evaluation, retry with the new immutable law.
  if (select hash from public.processes where id = p->>'frequency') is distinct from law_hash then
    return jsonb_build_object('kind','retry');
  end if;
  select array(select jsonb_array_elements_text(p->'spent') order by 1) into expected_spent;
  old_spent := public.logline_spent(law, p->'claims');
  if old_spent is distinct from expected_spent then return jsonb_build_object('kind','retry'); end if;
  begin
    insert into public.submissions(cache_key, receipt_id) values (idem, rid) on conflict (cache_key) do nothing;
    get diagnostics inserted = row_count;
    if inserted = 0 then
      select receipt_id into strict previous_id from public.submissions where cache_key = idem;
      return jsonb_build_object('kind','replayed','id',previous_id);
    end if;
    -- Acquire CAS keys in a consistent order, including when tuple and detail share bytes.
    if (p->>'input_hash') < (p->>'detail_hash') then
      perform public.logline_put(p->>'input_hash', p->>'tuple');
      perform public.logline_put(p->>'detail_hash', p->>'detail');
    else
      perform public.logline_put(p->>'detail_hash', p->>'detail');
      perform public.logline_put(p->>'input_hash', p->>'tuple');
    end if;
    insert into public.receipts(id, frequency, status, by, process_hash, activated, receipt)
      values (rid, p->>'frequency', p->>'status', p->>'by', law_hash, (p->>'activated')::boolean, p->>'receipt');
    insert into public.receipt_access(receipt_id, owner, input_hash, detail_hash)
      values (rid, (p->>'owner')::uuid, p->>'input_hash', p->>'detail_hash');
    if p->>'status' = 'ok' then
      for claim in select * from jsonb_to_recordset(p->'claims') as x(slot text, cited_id text) order by slot, cited_id loop
        insert into public.consumptions(process_id, slot, cited_id, consumed_by)
          values (law, claim.slot, claim.cited_id, rid) on conflict do nothing;
        get diagnostics inserted = row_count;
        if inserted = 0 then raise exception using errcode = 'LL001', message = 'once conflict'; end if;
      end loop;
    end if;
    return jsonb_build_object('kind','committed','id',rid);
  exception when sqlstate 'LL001' then
    return jsonb_build_object('kind','retry');
  end;
end $$;

alter table public.objects enable row level security;
alter table public.processes enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_access enable row level security;
alter table public.submissions enable row level security;
alter table public.consumptions enable row level security;
alter table public.outbox enable row level security;
alter table public.reaction_jobs enable row level security;
revoke all on public.objects, public.processes, public.receipts, public.receipt_access,
  public.submissions, public.consumptions, public.outbox, public.reaction_jobs from public, anon, authenticated, service_role;
grant select on public.objects, public.processes, public.receipts to anon, authenticated;
grant select on public.receipt_access to authenticated;
grant select, insert on public.objects, public.processes, public.receipts, public.receipt_access,
  public.submissions, public.consumptions, public.outbox, public.reaction_jobs to service_role;
grant update (dispatched_at) on public.outbox to service_role;
grant usage, select on sequence public.receipts_seq_seq to service_role;
create policy public_processes on public.processes for select to anon, authenticated using (true);
create policy public_receipts on public.receipts for select to anon, authenticated using (true);
create policy own_receipt_access on public.receipt_access for select to authenticated using (
  owner = (select auth.uid()) or (select auth.jwt()->'app_metadata'->'logline_admin') = 'true'::jsonb
);
-- Keep the anonymous policy separate: it must not read a table it cannot SELECT.
create policy public_cas on public.objects for select to anon, authenticated using (
  exists (select 1 from public.processes p where p.hash = objects.hash)
);
create policy own_cas on public.objects for select to authenticated using (
  exists (select 1 from public.receipt_access a where objects.hash in (a.input_hash, a.detail_hash))
);
revoke execute on function public.logline_immutable(), public.logline_enqueue(), public.logline_put(text,text),
  public.logline_publish(text,text,text), public.logline_spent(text,jsonb), public.logline_commit(jsonb)
  from public, anon, authenticated;
grant execute on function public.logline_immutable(), public.logline_enqueue(), public.logline_put(text,text),
  public.logline_publish(text,text,text), public.logline_spent(text,jsonb), public.logline_commit(jsonb) to service_role;
alter publication supabase_realtime add table public.receipts;
