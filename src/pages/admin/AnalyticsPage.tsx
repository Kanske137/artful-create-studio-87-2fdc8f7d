// Admin → Analytics (Fas 3): sessionslista med tratt-status, tidslinje per
// session och bildgallerier (uppladdat → genererat). Läser data via admin-
// sessionen (RLS kräver admin-e-posten). Svenska — adminytan är intern.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  LogOut,
  Monitor,
  RefreshCw,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Users,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  cartPreviewUrl,
  fetchEvents,
  fetchFeedback,
  fetchGenerations,
  fetchSessions,
  fetchSummaryCounts,
  shopifyOrderAdminUrl,
  type EventRow,
  type FeedbackRow,
  type GenerationRow,
  type SessionRow,
  type SummaryCounts,
} from "@/lib/admin-analytics";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "nyss";
  if (m < 60) return `${m} min sedan`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h sedan`;
  return `${Math.floor(h / 24)} d sedan`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("sv-SE", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface SessionAgg {
  uploads: number;
  gens: number;
  gensOk: number;
  gensFail: number;
  cartAdds: number;
  orders: number;
}

const EMPTY_AGG: SessionAgg = { uploads: 0, gens: 0, gensOk: 0, gensFail: 0, cartAdds: 0, orders: 0 };

function Thumb({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={label}
      className="block h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted"
    >
      <img src={url} alt={label} loading="lazy" className="h-full w-full object-cover" />
    </a>
  );
}

export default function AnalyticsPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [generations, setGenerations] = useState<GenerationRow[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [counts, setCounts] = useState<SummaryCounts | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Filter (klientsidigt över det inlästa fönstret).
  const [q, setQ] = useState("");
  const [handleFilter, setHandleFilter] = useState("alla");
  const [activityFilter, setActivityFilter] = useState<
    "alla" | "upload" | "gen" | "cart" | "order" | "feedback"
  >("alla");
  const [periodDays, setPeriodDays] = useState(7);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
        const [s, e, g, f, c] = await Promise.all([
          fetchSessions(),
          fetchEvents(),
          fetchGenerations(),
          // Feedback-tabellen kan saknas tills migrationen körts — svälj felet.
          fetchFeedback().catch(() => [] as FeedbackRow[]),
          // Riktiga räknare utan hämtningstak — faller tillbaka på listorna.
          fetchSummaryCounts(since).catch(() => null),
        ]);
        setSessions(s);
        setEvents(e);
        setGenerations(g);
        setFeedback(f);
        setCounts(c);
        setLastUpdated(new Date());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Okänt fel");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [periodDays],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-uppdatering varje minut — tyst, utan spinner som stör läsningen.
  useEffect(() => {
    const id = window.setInterval(() => {
      void load(true);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const aggBySession = useMemo(() => {
    const map = new Map<string, SessionAgg>();
    const get = (key: string) => {
      let a = map.get(key);
      if (!a) {
        a = { ...EMPTY_AGG };
        map.set(key, a);
      }
      return a;
    };
    for (const e of events) {
      const a = get(e.session_key);
      if (e.type === "photo_uploaded") a.uploads++;
      else if (e.type === "add_to_cart") a.cartAdds++;
      else if (e.type === "order_placed") a.orders++;
    }
    for (const g of generations) {
      if (!g.session_key) continue;
      const a = get(g.session_key);
      a.gens++;
      if (g.status === "succeeded") a.gensOk++;
      else if (g.status === "failed") a.gensFail++;
    }
    return map;
  }, [events, generations]);

  // Senaste feedbacken per design-id (raderna kommer nyast först).
  const feedbackByDesign = useMemo(() => {
    const map = new Map<string, FeedbackRow>();
    for (const f of feedback) {
      if (f.design_id && !map.has(f.design_id)) map.set(f.design_id, f);
    }
    return map;
  }, [feedback]);

  // Sessioner sorterade på FAKTISK senaste aktivitet (max av last_seen_at,
  // events, genereringar, feedback) — last_seen_at kan släpa (t.ex. gamla
  // flikar) och då hamnade aktiva sessioner annars långt ner eller utanför
  // listan. Sessionsnycklar som bara syns via aktivitet (raden saknas/ej
  // hämtad) får en syntetisk rad så deras tidslinje aldrig blir osynlig.
  const sessionsByActivity = useMemo(() => {
    const activity = new Map<string, number>();
    const bump = (key: string | null | undefined, ts: string | null | undefined) => {
      if (!key || !ts) return;
      const t = new Date(ts).getTime();
      if (!Number.isFinite(t)) return;
      const prev = activity.get(key) ?? 0;
      if (t > prev) activity.set(key, t);
    };
    for (const e of events) bump(e.session_key, e.ts);
    for (const g of generations) bump(g.session_key, g.created_at);
    for (const f of feedback) bump(f.session_key, f.created_at);

    const known = new Set(sessions.map((s) => s.session_key));
    const synthetic: SessionRow[] = [];
    for (const [key, t] of activity) {
      if (known.has(key)) continue;
      const iso = new Date(t).toISOString();
      synthetic.push({
        id: key,
        session_key: key,
        created_at: iso,
        last_seen_at: iso,
        locale: null,
        country: null,
        device: null,
        embedded: null,
        first_handle: null,
        email: null,
        email_linked_at: null,
      });
    }

    const effective = (s: SessionRow) =>
      Math.max(new Date(s.last_seen_at).getTime() || 0, activity.get(s.session_key) ?? 0);
    return [...sessions, ...synthetic]
      .map((s) => ({ ...s, last_seen_at: new Date(effective(s)).toISOString() }))
      .sort((a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime());
  }, [sessions, events, generations, feedback]);

  const periodMs = periodDays * 24 * 60 * 60 * 1000;

  const summary = useMemo(() => {
    const cutoff = Date.now() - periodMs;
    const recentSessions = sessionsByActivity.filter(
      (s) => new Date(s.last_seen_at).getTime() >= cutoff,
    );
    const recentEvents = events.filter((e) => new Date(e.ts).getTime() >= cutoff);
    const recentGens = generations.filter((g) => new Date(g.created_at).getTime() >= cutoff);
    const ok = recentGens.filter((g) => g.status === "succeeded").length;
    const done = recentGens.filter((g) => g.status !== "started").length;
    const up = feedback.filter(
      (f) => f.rating === "up" && new Date(f.created_at).getTime() >= cutoff,
    ).length;
    const down = feedback.filter(
      (f) => f.rating === "down" && new Date(f.created_at).getTime() >= cutoff,
    ).length;
    return {
      sessions: counts?.sessions ?? recentSessions.length,
      gens: counts?.generations ?? recentGens.length,
      gensRate:
        counts && counts.generations > 0
          ? Math.round((counts.generationsOk / counts.generations) * 100)
          : done > 0
            ? Math.round((ok / done) * 100)
            : null,
      cartAdds: counts?.cartAdds ?? recentEvents.filter((e) => e.type === "add_to_cart").length,
      orders: counts?.orders ?? recentEvents.filter((e) => e.type === "order_placed").length,
      feedbackUp: counts?.feedbackUp ?? up,
      feedbackDown: counts?.feedbackDown ?? down,
    };
  }, [sessionsByActivity, events, generations, feedback, counts, periodMs]);

  // Tratt inom perioden (från inläst fönster): hur långt sessionerna når.
  const funnel = useMemo(() => {
    const cutoff = Date.now() - periodMs;
    const active = new Set<string>();
    for (const s of sessionsByActivity) {
      if (new Date(s.last_seen_at).getTime() >= cutoff) active.add(s.session_key);
    }
    const withUpload = new Set<string>();
    const withCart = new Set<string>();
    const withOrder = new Set<string>();
    for (const e of events) {
      if (new Date(e.ts).getTime() < cutoff) continue;
      if (e.type === "photo_uploaded") withUpload.add(e.session_key);
      else if (e.type === "add_to_cart") withCart.add(e.session_key);
      else if (e.type === "order_placed") withOrder.add(e.session_key);
    }
    const withGen = new Set<string>();
    for (const g of generations) {
      if (!g.session_key || g.status !== "succeeded") continue;
      if (new Date(g.created_at).getTime() < cutoff) continue;
      withGen.add(g.session_key);
    }
    const base = active.size;
    const pct = (n: number) => (base > 0 ? Math.round((n / base) * 100) : 0);
    return {
      base,
      upload: withUpload.size,
      uploadPct: pct(withUpload.size),
      gen: withGen.size,
      genPct: pct(withGen.size),
      cart: withCart.size,
      cartPct: pct(withCart.size),
      order: withOrder.size,
      orderPct: pct(withOrder.size),
    };
  }, [sessionsByActivity, events, generations, periodMs]);

  // Mallar per session (för mallfiltret) + alla kända mallar.
  const handlesBySession = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (key: string | null | undefined, handle: string | null | undefined) => {
      if (!key || !handle) return;
      let set = map.get(key);
      if (!set) {
        set = new Set();
        map.set(key, set);
      }
      set.add(handle);
    };
    for (const s of sessions) add(s.session_key, s.first_handle);
    for (const e of events) add(e.session_key, e.handle);
    for (const g of generations) add(g.session_key, g.handle);
    return map;
  }, [sessions, events, generations]);

  const allHandles = useMemo(() => {
    const set = new Set<string>();
    for (const handles of handlesBySession.values()) for (const h of handles) set.add(h);
    return [...set].sort();
  }, [handlesBySession]);

  const feedbackSessions = useMemo(() => {
    const set = new Set<string>();
    for (const f of feedback) if (f.session_key) set.add(f.session_key);
    return set;
  }, [feedback]);

  // Filtrerade sessioner (period + aktivitet + mall + fritext).
  const visibleSessions = useMemo(() => {
    const cutoff = Date.now() - periodMs;
    const qq = q.trim().toLowerCase();
    return sessionsByActivity.filter((s) => {
      if (new Date(s.last_seen_at).getTime() < cutoff) return false;
      const a = aggBySession.get(s.session_key) ?? EMPTY_AGG;
      if (activityFilter === "upload" && a.uploads === 0) return false;
      if (activityFilter === "gen" && a.gens === 0) return false;
      if (activityFilter === "cart" && a.cartAdds === 0) return false;
      if (activityFilter === "order" && a.orders === 0) return false;
      if (activityFilter === "feedback" && !feedbackSessions.has(s.session_key)) return false;
      if (handleFilter !== "alla" && !handlesBySession.get(s.session_key)?.has(handleFilter)) {
        return false;
      }
      if (
        qq &&
        !s.session_key.toLowerCase().includes(qq) &&
        !(s.email ?? "").toLowerCase().includes(qq)
      ) {
        return false;
      }
      return true;
    });
  }, [
    sessionsByActivity,
    aggBySession,
    feedbackSessions,
    handlesBySession,
    activityFilter,
    handleFilter,
    q,
    periodMs,
  ]);

  // Gruppera per person när e-post finns — samma kund har ofta flera sessioner
  // (en per enhet/webbläsarkontext), vilket annars ser ut som "fel datum".
  const grouped = useMemo(() => {
    type Item =
      | { kind: "person"; email: string; sessions: SessionRow[] }
      | { kind: "anon"; session: SessionRow };
    const byEmail = new Map<string, SessionRow[]>();
    for (const s of visibleSessions) {
      if (!s.email) continue;
      const list = byEmail.get(s.email);
      if (list) list.push(s);
      else byEmail.set(s.email, [s]);
    }
    const items: Item[] = [];
    const seenEmails = new Set<string>();
    for (const s of visibleSessions) {
      if (s.email) {
        if (!seenEmails.has(s.email)) {
          seenEmails.add(s.email);
          items.push({ kind: "person", email: s.email, sessions: byEmail.get(s.email)! });
        }
      } else {
        items.push({ kind: "anon", session: s });
      }
    }
    return items;
  }, [visibleSessions]);

  const detailFor = (sessionKey: string) => {
    const evts = events.filter((e) => e.session_key === sessionKey);
    const gens = generations.filter((g) => g.session_key === sessionKey);
    const items: Array<{ ts: string; node: JSX.Element }> = [];
    for (const e of evts) {
      if (e.type === "editor_opened") {
        items.push({
          ts: e.ts,
          node: (
            <span>
              Öppnade editorn — <b>{e.handle}</b> ({e.product_type})
            </span>
          ),
        });
      } else if (e.type === "photo_uploaded") {
        items.push({
          ts: e.ts,
          node: (
            <span>
              <ImageIcon className="inline h-3.5 w-3.5 mr-1" />
              Laddade upp bild ({String(e.payload.kind ?? "foto")}) — {e.handle}
            </span>
          ),
        });
      } else if (e.type === "add_to_cart") {
        const p = e.payload as { size?: string; variant?: string; priceSek?: number };
        items.push({
          ts: e.ts,
          node: (
            <div className="flex items-center gap-3">
              <span>
                <ShoppingCart className="inline h-3.5 w-3.5 mr-1" />
                La i varukorgen — <b>{e.handle}</b> {p.size} · {p.variant} · {p.priceSek} kr
              </span>
              {e.design_id && <Thumb url={cartPreviewUrl(e.design_id)} label="Kundvagnsbild" />}
            </div>
          ),
        });
      } else if (e.type === "order_placed") {
        const p = e.payload as { shopifyOrderId?: string; orderName?: string; size?: string; variant?: string };
        items.push({
          ts: e.ts,
          node: (
            <span className="font-medium text-emerald-700 dark:text-emerald-400">
              ✓ KÖP — {p.orderName ?? ""} ({e.handle} {p.size} · {p.variant}){" "}
              {p.shopifyOrderId && (
                <a
                  href={shopifyOrderAdminUrl(p.shopifyOrderId)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  öppna i Shopify
                </a>
              )}
            </span>
          ),
        });
      } else {
        items.push({ ts: e.ts, node: <span>{e.type}</span> });
      }
    }
    for (const g of gens) {
      // Multiface loggar alla porträtt i input_image_urls; äldre rader och
      // enbildslägen har bara singularen — visa vad som finns.
      const inputUrls = (
        g.input_image_urls && g.input_image_urls.length > 0 ? g.input_image_urls : [g.input_image_url]
      ).filter((u): u is string => !!u);
      items.push({
        ts: g.created_at,
        node: (
          <div className="flex items-center gap-3 flex-wrap">
            <span>
              <Wand2 className="inline h-3.5 w-3.5 mr-1" />
              Generering ({g.subject_kind}
              {g.style_label ? ` · ${g.style_label}` : ""}) —{" "}
              {g.status === "succeeded" ? (
                <b className="text-emerald-700 dark:text-emerald-400">lyckades</b>
              ) : g.status === "failed" ? (
                <b className="text-destructive">misslyckades</b>
              ) : (
                <b>pågår…</b>
              )}
              {typeof g.duration_ms === "number" && ` på ${(g.duration_ms / 1000).toFixed(1)} s`}
              {g.error && <span className="text-destructive"> — {g.error}</span>}
            </span>
            {(() => {
              const fb = g.design_id ? feedbackByDesign.get(g.design_id) : undefined;
              if (!fb) return null;
              return (
                <span
                  className={
                    fb.rating === "up"
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-destructive"
                  }
                  title={`Kundfeedback ${new Date(fb.created_at).toLocaleString("sv-SE")}`}
                >
                  {fb.rating === "up" ? "👍" : "👎"}
                  {fb.comment && (
                    <span className="text-muted-foreground"> ”{fb.comment}”</span>
                  )}
                </span>
              );
            })()}
            <div className="flex items-center gap-1.5">
              {inputUrls.map((u, idx) => (
                <Thumb
                  key={u}
                  url={u}
                  label={inputUrls.length > 1 ? `Uppladdad bild ${idx + 1}` : "Uppladdad bild"}
                />
              ))}
              {inputUrls.length > 0 && g.output_image_url && <span className="text-muted-foreground">→</span>}
              {g.output_image_url && <Thumb url={g.output_image_url} label="Genererad bild" />}
            </div>
          </div>
        ),
      });
    }
    items.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    return items;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Analytics
            </h1>
            <p className="text-sm text-muted-foreground">
              Sessioner, genereringar och kundbeteende i editorn
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/">Mallar</Link>
            </Button>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" onClick={() => void supabase.auth.signOut()} title="Logga ut">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Sammanfattning för vald period — riktiga räknare, ej takade av listgränser */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: `Sessioner (${periodDays} d)`, value: String(summary.sessions) },
            {
              label: `Genereringar (${periodDays} d)`,
              value: `${summary.gens}${summary.gensRate !== null ? ` · ${summary.gensRate}% ok` : ""}`,
            },
            { label: `Varukorg (${periodDays} d)`, value: String(summary.cartAdds) },
            { label: `Ordrar (${periodDays} d)`, value: String(summary.orders) },
            {
              label: `Feedback (${periodDays} d)`,
              value: `👍 ${summary.feedbackUp} · 👎 ${summary.feedbackDown}`,
            },
          ].map((c) => (
            <div key={c.label} className="rounded-lg border bg-card p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</div>
              <div className="text-2xl font-semibold mt-1">{c.value}</div>
            </div>
          ))}
        </div>

        {/* Tratt: hur långt sessionerna når inom perioden */}
        <div className="rounded-lg border bg-card p-4 text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{funnel.base} sessioner</span>
          <span className="text-muted-foreground">→</span>
          <span>
            {funnel.upload} laddade upp <b>({funnel.uploadPct} %)</b>
          </span>
          <span className="text-muted-foreground">→</span>
          <span>
            {funnel.gen} genererade <b>({funnel.genPct} %)</b>
          </span>
          <span className="text-muted-foreground">→</span>
          <span>
            {funnel.cart} varukorg <b>({funnel.cartPct} %)</b>
          </span>
          <span className="text-muted-foreground">→</span>
          <span>
            {funnel.order} köpte <b>({funnel.orderPct} %)</b>
          </span>
          {lastUpdated && (
            <span className="ml-auto text-xs text-muted-foreground">
              Uppdaterad {lastUpdated.toLocaleTimeString("sv-SE")} · auto varje minut
            </span>
          )}
        </div>

        {/* Filter */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                ["alla", "Alla"],
                ["upload", "Uppladdning"],
                ["gen", "Generering"],
                ["cart", "Varukorg"],
                ["order", "Köp"],
                ["feedback", "Feedback"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={activityFilter === key ? "default" : "outline"}
                onClick={() => setActivityFilter(key)}
              >
                {label}
              </Button>
            ))}
          </div>
          <select
            value={handleFilter}
            onChange={(e) => setHandleFilter(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="alla">Alla mallar</option>
            {allHandles.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <select
            value={periodDays}
            onChange={(e) => setPeriodDays(Number(e.target.value))}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value={1}>Idag (24 h)</option>
            <option value={7}>7 dagar</option>
            <option value={30}>30 dagar</option>
          </select>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Sök e-post eller sessions-id…"
            className="h-9 w-56"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            Kunde inte läsa analytics-data: {error}
          </div>
        )}

        {loading && sessions.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : sessions.length === 0 && !error ? (
          <div className="p-8 rounded-lg border border-dashed text-center text-sm text-muted-foreground">
            Inga sessioner ännu. Data börjar samlas så fort kunder öppnar editorn.
          </div>
        ) : (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Senaste sessionerna
            </h2>
            {(() => {
              const renderSession = (s: SessionRow) => {
              const a = aggBySession.get(s.session_key) ?? EMPTY_AGG;
              const isOpen = expanded === s.session_key;
              return (
                <div key={s.session_key} className="rounded-lg border bg-card">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : s.session_key)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">
                          {s.email ?? `Anonym · ${s.session_key.slice(0, 8)}`}
                        </span>
                        {s.device === "mobile" ? (
                          <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        {s.locale && <Badge variant="outline">{s.locale}</Badge>}
                        {s.first_handle && <Badge variant="outline">{s.first_handle}</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Senast aktiv {timeAgo(s.last_seen_at)} · första besök{" "}
                        {new Date(s.created_at).toLocaleDateString("sv-SE")}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-xs">
                      {a.uploads > 0 && (
                        <Badge variant="secondary">
                          <ImageIcon className="h-3 w-3 mr-1" />
                          {a.uploads}
                        </Badge>
                      )}
                      {a.gens > 0 && (
                        <Badge variant="secondary">
                          <Sparkles className="h-3 w-3 mr-1" />
                          {a.gensOk}/{a.gens}
                        </Badge>
                      )}
                      {a.cartAdds > 0 && (
                        <Badge variant="secondary">
                          <ShoppingCart className="h-3 w-3 mr-1" />
                          {a.cartAdds}
                        </Badge>
                      )}
                      {a.orders > 0 && <Badge className="bg-emerald-600 text-white">KÖP</Badge>}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t px-4 py-3">
                      <ol className="space-y-2 text-sm">
                        {detailFor(s.session_key).map((item, i) => (
                          <li key={i} className="flex gap-3">
                            <span className="shrink-0 w-28 text-xs text-muted-foreground pt-0.5">
                              {fmtTime(item.ts)}
                            </span>
                            <div className="min-w-0">{item.node}</div>
                          </li>
                        ))}
                        {detailFor(s.session_key).length === 0 && (
                          <li className="text-muted-foreground text-xs">
                            Inga händelser inom det inlästa fönstret.
                          </li>
                        )}
                      </ol>
                    </div>
                  )}
                </div>
              );
              };
              if (grouped.length === 0) {
                return (
                  <div className="p-6 rounded-lg border border-dashed text-center text-sm text-muted-foreground">
                    Inga sessioner matchar filtren.
                  </div>
                );
              }
              return grouped.map((item) =>
                item.kind === "anon" ? (
                  renderSession(item.session)
                ) : (
                  <div
                    key={`person:${item.email}`}
                    className="rounded-lg border-2 border-primary/25 bg-card/60 p-2 space-y-2"
                  >
                    <div className="flex items-center gap-2 px-2 pt-1 text-sm flex-wrap">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold">{item.email}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.sessions.length}{" "}
                        {item.sessions.length === 1 ? "session" : "sessioner"} · första besök{" "}
                        {new Date(
                          Math.min(...item.sessions.map((x) => new Date(x.created_at).getTime())),
                        ).toLocaleDateString("sv-SE")}{" "}
                        · senast aktiv {timeAgo(item.sessions[0].last_seen_at)}
                      </span>
                    </div>
                    {item.sessions.map(renderSession)}
                  </div>
                ),
              );
            })()}
            <p className="text-[11px] text-muted-foreground pt-1">
              Visar {visibleSessions.length} av {sessionsByActivity.length} inlästa sessioner
              (fönster: {sessions.length} sessioner, {events.length} händelser,{" "}
              {generations.length} genereringar). En session = en enhet/webbläsarkontext — samma
              kund kan ha flera, och med registrerad e-post grupperas de till en person.
              Kundbilder öppnas i ny flik.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
