-- Fas 4: prenumerant-gate. Kunden får EN gratis AI-generering per enhet
-- (session_key i localStorage); därefter krävs e-postregistrering innan fler
-- genereringar. E-post + ev. nyhetsbrevssamtycke lagras här som GDPR-spår.
-- Tabellen skrivs enbart av edge-funktionen subscriber-gate (service role);
-- admin läser via e-postbunden policy — anon kommer aldrig åt något.
create table if not exists public.subscribers (
  email text primary key,
  created_at timestamptz not null default now(),
  newsletter_consent boolean not null default false,
  newsletter_consent_at timestamptz,
  locale text,
  source_session_key text,
  shopify_customer_id text,
  shopify_synced_at timestamptz
);

alter table public.subscribers enable row level security;

revoke all on table public.subscribers from anon, authenticated;

create policy "admin_read_subscribers" on public.subscribers
  for select to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'akram@arthena.se');
grant select on table public.subscribers to authenticated;

-- Gatens rate-limit-fråga slår upp alla sessioner per e-post.
create index if not exists editor_sessions_email_idx
  on public.editor_sessions (email) where email is not null;
