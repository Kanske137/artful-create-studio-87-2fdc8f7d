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
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  cartPreviewUrl,
  fetchEvents,
  fetchGenerations,
  fetchSessions,
  shopifyOrderAdminUrl,
  type EventRow,
  type GenerationRow,
  type SessionRow,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, e, g] = await Promise.all([fetchSessions(), fetchEvents(), fetchGenerations()]);
      setSessions(s);
      setEvents(e);
      setGenerations(g);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Okänt fel");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
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

  const summary = useMemo(() => {
    const cutoff = Date.now() - WEEK_MS;
    const recentSessions = sessions.filter((s) => new Date(s.last_seen_at).getTime() >= cutoff);
    const recentEvents = events.filter((e) => new Date(e.ts).getTime() >= cutoff);
    const recentGens = generations.filter((g) => new Date(g.created_at).getTime() >= cutoff);
    const ok = recentGens.filter((g) => g.status === "succeeded").length;
    const done = recentGens.filter((g) => g.status !== "started").length;
    return {
      sessions: recentSessions.length,
      gens: recentGens.length,
      gensRate: done > 0 ? Math.round((ok / done) * 100) : null,
      cartAdds: recentEvents.filter((e) => e.type === "add_to_cart").length,
      orders: recentEvents.filter((e) => e.type === "order_placed").length,
    };
  }, [sessions, events, generations]);

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
            <div className="flex items-center gap-1.5">
              {g.input_image_url && <Thumb url={g.input_image_url} label="Uppladdad bild" />}
              {(g.input_image_url && g.output_image_url) && <span className="text-muted-foreground">→</span>}
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
        {/* Sammanfattning senaste 7 dagarna */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Sessioner (7 d)", value: String(summary.sessions) },
            {
              label: "Genereringar (7 d)",
              value: `${summary.gens}${summary.gensRate !== null ? ` · ${summary.gensRate}% ok` : ""}`,
            },
            { label: "Lagt i varukorg (7 d)", value: String(summary.cartAdds) },
            { label: "Ordrar (7 d)", value: String(summary.orders) },
          ].map((c) => (
            <div key={c.label} className="rounded-lg border bg-card p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</div>
              <div className="text-2xl font-semibold mt-1">{c.value}</div>
            </div>
          ))}
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
            {sessions.map((s) => {
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
            })}
            <p className="text-[11px] text-muted-foreground pt-1">
              Visar senaste {sessions.length} sessionerna, {events.length} händelserna och{" "}
              {generations.length} genereringarna. Kundbilder öppnas i ny flik.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
