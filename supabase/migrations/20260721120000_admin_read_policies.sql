-- Läsrättigheter för admin-Analytics (Fas 3). Bundna till admin-e-posten på
-- DATABASNIVÅ: även om någon annan registrerar ett konto via login-sidan får
-- den aldrig läsa någon analytics-data. Måste hållas i synk med ADMIN_EMAILS
-- i src/lib/admin-auth.ts.

grant select on public.editor_sessions to authenticated;
grant select on public.editor_events to authenticated;
grant select on public.generations to authenticated;

create policy "admin_read_sessions" on public.editor_sessions
  for select to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'akram@arthena.se');

create policy "admin_read_events" on public.editor_events
  for select to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'akram@arthena.se');

create policy "admin_read_generations" on public.generations
  for select to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'akram@arthena.se');
