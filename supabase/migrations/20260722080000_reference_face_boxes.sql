-- Lådcache för multi-face cdingram-motorn (Steg 1, ?engine=cdingram).
-- Ansiktslådor detekteras en gång per referens-URL (grounding-dino) och
-- återanvänds därefter. Skrivs/läses ENBART av edge-funktioner med service
-- role — klienten har inga rättigheter alls (RLS på, inga policys).
create table if not exists public.reference_face_boxes (
  reference_url text primary key,
  boxes jsonb not null,
  provider text,
  detected_at timestamptz not null default now()
);

alter table public.reference_face_boxes enable row level security;
revoke all on public.reference_face_boxes from anon, authenticated;
