-- Paket C: nattlig gallring. Schemalägger cleanup-cron-funktionen via
-- pg_cron + pg_net (02:30 varje natt) och skapar last_seen-synkfunktionen
-- (klientens direktuppdatering av last_seen_at är opålitlig i miljön —
-- events är facit). Anon-nyckeln i headern är publik; x-cleanup-secret
-- matchar CLEANUP_CRON_SECRET i function-secrets.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Synka last_seen_at från senaste händelsen per session. SECURITY DEFINER
-- så cron/edge (service role) kan köra den; ingen annan får exekvera.
create or replace function public.sync_last_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.editor_sessions s
  set last_seen_at = e.mx
  from (
    select session_key, max(ts) as mx
    from public.editor_events
    group by session_key
  ) e
  where e.session_key = s.session_key
    and e.mx > s.last_seen_at;
$$;

revoke all on function public.sync_last_seen() from public, anon, authenticated;

-- Idempotent schemaläggning: avschemalägg ev. tidigare jobb först.
do $$
begin
  perform cron.unschedule('arthena-cleanup-nightly');
exception when others then
  null;
end
$$;

select cron.schedule(
  'arthena-cleanup-nightly',
  '30 2 * * *',
  $cron$
  select net.http_post(
    url := 'https://ptzmnusfgdwcqpjpbyco.supabase.co/functions/v1/cleanup-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0em1udXNmZ2R3Y3FwanBieWNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2OTQ0MzgsImV4cCI6MjA5MjI3MDQzOH0.Prk4J6NlmplZyiW12rlZpzfgiwP96GLyWXjOoTU7KGQ',
      'x-cleanup-secret', '4b509b38b29948b99ec7d29a03bafdd46ce8998d774b4820b860ca4fb2d36404'
    ),
    body := '{}'::jsonb
  );
  $cron$
);