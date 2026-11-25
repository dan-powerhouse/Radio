-- LogLine Receipt v1: CAS + ledger + radio. DRAFT, not applied anywhere yet.
-- Writes happen only through the submit function (service role). Clients read and listen.

create table public.objects (
  hash        text primary key check (hash ~ '^sha256:[0-9a-f]{64}$'),
  kind        text not null check (kind in ('tuple','process','detail','evidence')),
  body        jsonb,                         -- null once erased or when stored in Storage
  public      boolean not null default false,
  owner       uuid references auth.users(id),-- private objects: the submitter
  created_at  timestamptz not null default now()
);

create table public.receipts (
  id           text primary key check (id ~ '^sha256:[0-9a-f]{64}$'),
  seq          bigint generated always as identity unique, -- ledger order, for late listeners
  frequency    text not null,
  status       text not null check (status in ('registered','ok','doubt','not')),
  by           text,                                     -- pseudonym, never an account id
  process_hash text,
  input_hash   text not null,
  detail_hash  text not null,
  "when"       text not null,
  prev         text[] not null default '{}',
  header       jsonb not null,                           -- the full signed header, verbatim
  sig          jsonb not null,
  owner        uuid references auth.users(id),           -- never broadcast; used only by RLS
  private      boolean not null default false
);
create index receipts_frequency_seq on public.receipts (frequency, seq);
create index receipts_by_seq on public.receipts (by, seq);

create table public.listeners (
  process_hash text not null references public.objects(hash),
  tuning       jsonb not null,                           -- SPEC §9 tuning object
  registered_by_receipt text references public.receipts(id), -- tuning in is itself on the record
  primary key (process_hash, tuning)
);

create table public.jobs (
  id          bigint generated always as identity primary key,
  trigger_id  text not null references public.receipts(id),
  process_hash text not null,
  depth       int not null,
  budget      int not null,
  claimed_at  timestamptz,
  done_at     timestamptz,
  unique (trigger_id, process_hash)                      -- a receipt triggers a process at most once
);

create table public.keys (
  key_id     text primary key,
  jwk        jsonb not null,
  not_before text not null,
  not_after  text
);

-- Ledger and CAS are append-only, even for the service role (erasure nulls objects.body only).
create function public.forbid_change() returns trigger language plpgsql as $$
begin raise exception 'append-only table %', tg_table_name; end $$;
create trigger receipts_append_only before update or delete on public.receipts for each row execute function public.forbid_change();
create function public.objects_erase_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or new.hash <> old.hash or new.kind <> old.kind or new.body is not null then
    raise exception 'objects are immutable; erasure sets body to null';
  end if;
  return new;
end $$;
create trigger objects_erase_only before update or delete on public.objects for each row execute function public.objects_erase_only();

alter table public.objects   enable row level security;
alter table public.receipts  enable row level security;
alter table public.listeners enable row level security;
alter table public.jobs      enable row level security;
alter table public.keys      enable row level security;

create policy "public objects"   on public.objects  for select using (public);
create policy "own objects"      on public.objects  for select to authenticated using (owner = (select auth.uid()));
create policy "public receipts"  on public.receipts for select using (not private);
create policy "own receipts"     on public.receipts for select to authenticated using (owner = (select auth.uid()));
create policy "who listens is public" on public.listeners for select using (true);
create policy "keys are public"  on public.keys     for select using (true);
-- jobs: no policy, so only the service role can touch it.

-- The radio: Realtime broadcasts receipt inserts; clients filter by frequency or by.
alter publication supabase_realtime add table public.receipts;
