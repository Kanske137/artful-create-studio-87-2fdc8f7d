// Enkel admin-auth för adminsidorna (Fas 3 i analytics-planen).
//
// Modell: Supabase Auth (e-post + lösenord) med EN tillåten admin-adress.
// Klientlistan här är bara UX — det verkliga skyddet ligger i databasen:
// RLS-läspolicys (migration 20260721120000_admin_read_policies.sql) är
// bundna till samma e-postadress, så ett godtyckligt registrerat konto får
// aldrig läsa någon data även om det loggar in.
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** Måste hållas i synk med RLS-policys i admin_read_policies-migrationen. */
export const ADMIN_EMAILS = ["akram@arthena.se"];

export function isAdminSession(session: Session | null): boolean {
  const email = session?.user?.email?.toLowerCase();
  return !!email && ADMIN_EMAILS.includes(email);
}

/** Prenumerera på auth-läget. Lyssnaren registreras före getSession så inga
 *  statusbyten tappas (Supabase-praxis). */
export function useAdminSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);
  return { session, loading, isAdmin: isAdminSession(session) };
}
