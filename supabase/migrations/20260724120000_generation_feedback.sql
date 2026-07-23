-- Paket B: kundfeedback per generering (tumme upp/ner + frivillig kommentar
-- vid tumme ner). Skrivs av klienten (anon, insert-only — samma härdning som
-- editor_events); läses endast av admin via e-postbunden policy.
create table if not exists public.generation_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  design_id text not null,
  session_key text,
  handle text,
  provider text,
  rating text not null check (rating in ('up', 'down')),
  comment text check (comment is null or char_length(comment) <= 1000)
);

create index if not exists generation_feedback_design_idx
  on public.generation_feedback (design_id);
create index if not exists generation_feedback_created_idx
  on public.generation_feedback (created_at desc);

alter table public.generation_feedback enable row level security;

-- `to public` — inte `to anon` — empiriskt krav i denna miljö (se
-- 20260721090000). Klienten gör vanlig insert, aldrig upsert.
create policy "feedback_insert_any" on public.generation_feedback
  for insert to public with check (true);

revoke select, update, delete on public.generation_feedback from anon, authenticated;

create policy "admin_read_feedback" on public.generation_feedback
  for select to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'akram@arthena.se');
grant select on table public.generation_feedback to authenticated;
