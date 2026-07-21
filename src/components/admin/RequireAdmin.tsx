// Grind för adminsidorna: visar inloggningsformulär tills en godkänd
// admin-session finns. Kunder berörs aldrig — /editor och /home är ogrindade.
//
// Registrering är avsiktligt tillåten MEN meningslös för utomstående:
// klienten släpper bara igenom e-postadresser i ADMIN_EMAILS, och databasens
// läspolicys är bundna till samma adress, så främmande konton ser ingenting.
import { useState, type ReactNode } from "react";
import { Loader2, Lock, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { ADMIN_EMAILS, useAdminSession } from "@/lib/admin-auth";
import { toast } from "sonner";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { session, loading, isAdmin } = useAdminSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (session && isAdmin) return <>{children}</>;

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  if (session && !isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold">Ingen admin-behörighet</h1>
          <p className="text-sm text-muted-foreground">
            Kontot {session.user.email} har inte tillgång till adminsidorna.
          </p>
        </div>
        <Button variant="outline" onClick={signOut}>
          <LogOut className="h-4 w-4 mr-2" />
          Logga ut
        </Button>
      </div>
    );
  }

  // Trimma alltid — autofyll/mobiltangentbord smyger ofta in blanksteg som
  // annars fäller allowlist-jämförelsen.
  const normEmail = email.trim();

  const signIn = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: normEmail, password });
      if (error) toast.error("Inloggning misslyckades", { description: error.message });
    } finally {
      setBusy(false);
    }
  };

  const signUp = async () => {
    if (!ADMIN_EMAILS.includes(normEmail.toLowerCase())) {
      toast.error("Endast admin-adressen kan registreras");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email: normEmail, password });
      if (error) {
        toast.error("Registrering misslyckades", { description: error.message });
      } else if (!data.session) {
        toast.info("Konto skapat", {
          description: "Bekräfta e-postadressen via länken i mejlet och logga sedan in.",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <form
        className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void signIn();
        }}
      >
        <div className="space-y-1 text-center">
          <Lock className="h-6 w-6 mx-auto text-muted-foreground" />
          <h1 className="text-lg font-semibold">Arthena Admin</h1>
          <p className="text-sm text-muted-foreground">Logga in för att fortsätta</p>
        </div>
        <Input
          type="email"
          placeholder="E-post"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          type="password"
          placeholder="Lösenord"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" className="w-full" disabled={busy || !email || !password}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Logga in"}
        </Button>
        <button
          type="button"
          onClick={() => void signUp()}
          disabled={busy}
          className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Första gången? Skapa admin-kontot
        </button>
      </form>
    </div>
  );
}
