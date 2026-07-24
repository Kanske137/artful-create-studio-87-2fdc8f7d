-- Bugfix: last_seen_at har ALDRIG uppdaterats för återkommande sessioner.
-- Orsak: "anon_update_sessions" är `to anon`, och `to anon`-policys biter
-- inte i denna miljö (samma empiriska fenomen som insert-buggen i
-- 20260721090000 — där löstes insert med `to public`, men update-policyn
-- blev kvar på `to anon`). PATCH:ar matchade därför 0 rader och PostgREST
-- svarar ändå 204. Kolumn-grants (last_seen_at, locale, country, device)
-- är oförändrade och skyddar fortsatt — e-post kan aldrig röras av anon.
drop policy if exists "anon_update_sessions" on public.editor_sessions;
create policy "sessions_update_any" on public.editor_sessions
  for update to public using (true) with check (true);