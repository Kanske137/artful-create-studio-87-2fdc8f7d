-- Editor-analytics (Fas 2): sessioner, händelser och genereringar.
-- Klienten (anon) får endast skapa sessioner/händelser och uppdatera
-- ofarliga sessionskolumner. All läsning sker med service role (edge/admin) —
-- kommande Analytics-sida läser via inloggad admin, aldrig via anon.

create table if not exists public.editor_sessions (
  id uuid primary key default gen_random_uuid(),
  session_key text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  locale text,
  country text,
  device text,
  embedded boolean,
  first_handle text,
  email text,
  email_linked_at timestamptz
);

create table if not exists public.editor_events (
  id bigint generated always as identity primary key,
  session_key text not null,
  ts timestamptz not null default now(),
  type text not null,
  design_id text,
  handle text,
  product_type text,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists editor_events_session_idx on public.editor_events (session_key, ts desc);
create index if not exists editor_events_type_idx on public.editor_events (type, ts desc);
create index if not exists editor_events_design_idx on public.editor_events (design_id) where design_id is not null;
create index if not exists editor_sessions_last_seen_idx on public.editor_sessions (last_seen_at desc);

create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  session_key text,
  design_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  handle text,
  layer_id text,
  subject_kind text,
  provider text,
  style_id text,
  style_label text,
  status text not null default 'started',
  error text,
  duration_ms integer,
  input_image_url text,
  reference_image_url text,
  output_image_url text
);

create index if not exists generations_session_idx on public.generations (session_key, created_at desc);
create index if not exists generations_status_idx on public.generations (status, created_at desc);

alter table public.editor_sessions enable row level security;
alter table public.editor_events enable row level security;
alter table public.generations enable row level security;

-- Anon: insert-only på händelser, insert + begränsad update på sessioner.
create policy "anon_insert_sessions" on public.editor_sessions
  for insert to anon with check (true);
create policy "anon_update_sessions" on public.editor_sessions
  for update to anon using (true) with check (true);
create policy "anon_insert_events" on public.editor_events
  for insert to anon with check (true);
-- generations skrivs enbart av edge-funktioner (service role) → inga anon-policys.

-- Kolumnnivå-härdning: anon kan aldrig läsa data och kan bara uppdatera
-- ofarliga sessionsfält (aldrig email). select(session_key) krävs för
-- WHERE-filtret i update; utan select-policy returnerar SELECT ändå 0 rader.
revoke select on public.editor_sessions from anon, authenticated;
revoke select on public.editor_events from anon, authenticated;
revoke select on public.generations from anon, authenticated;
revoke insert, update, delete on public.generations from anon, authenticated;
revoke update, delete on public.editor_sessions from anon, authenticated;
grant update (last_seen_at, locale, country, device) on public.editor_sessions to anon;
grant select (session_key) on public.editor_sessions to anon;
revoke update, delete on public.editor_events from anon, authenticated;
