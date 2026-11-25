// Admin → Porträttest (2026-11-25): jämför motorerna för personporträtt på
// samma foton. Varje körning går genom de riktiga edge-funktionerna
// (replicate-face-swap och multi-face-swap) med humanEngine + admin-JWT och
// loggas i generations-tabellen under session_key "portrait-test", så
// resultaten finns kvar och kan granskas i efterhand. Testerna räknas inte i
// editorns analys. Svenska — adminytan är intern.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ImagePlus, Loader2, Play, RefreshCw, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { uploadCartPreview } from "@/lib/upload-preview";
import { fetchPortraitTestGenerations, type GenerationRow } from "@/lib/admin-analytics";
import {
  PORTRAIT_ENGINES,
  PORTRAIT_TEST_SESSION_KEY,
  type PortraitEngine,
} from "@/lib/portrait-engine";
import { toast } from "sonner";

type Gender = "m" | "f";

interface Face {
  id: string;
  url: string;
  label: string;
  gender?: Gender;
}

interface RefImage {
  url: string;
  label?: string;
}

interface Slot {
  id: string;
  label: string;
  position: string;
}

interface TemplateInfo {
  handle: string;
  title: string;
  layerId: string;
  references: RefImage[];
  swapPrompt: string;
  slots: Slot[] | null;
}

interface Job {
  key: string;
  caseLabel: string;
  engine: PortraitEngine;
  status: "väntar" | "kör" | "klar" | "fel";
  message?: string;
}

const HANDLES = ["kungtavla", "drottningtavla", "kungligt-parportratt"];
const FACES_STORAGE_KEY = "arthena-portrait-test-faces";

/** Fiktiva testpersoner, skapade med Nano Banana 2 — inga riktiga kunder. */
const SYNTHETIC_FACES: Array<{ id: string; label: string; gender: Gender; prompt: string }> = [
  {
    id: "man-35-skagg",
    label: "Man 35, skägg",
    gender: "m",
    prompt:
      "Candid smartphone photo of a fictional 35-year-old Scandinavian man with short dark brown hair, a full trimmed beard, brown eyes and a slightly crooked nose, wearing a grey t-shirt in a home kitchen, natural window light, looking straight at the camera, head and shoulders. Realistic everyday photo, not a celebrity.",
  },
  {
    id: "kvinna-62-glasogon",
    label: "Kvinna 62, glasögon",
    gender: "f",
    prompt:
      "Candid smartphone photo of a fictional 62-year-old woman with a silver-grey chin-length bob, round tortoiseshell glasses, light wrinkles, a wide warm smile and a blue cardigan, in a living room, natural light, looking at the camera, head and shoulders. Realistic everyday photo, not a celebrity.",
  },
  {
    id: "man-28-lockigt",
    label: "Man 28, lockigt hår",
    gender: "m",
    prompt:
      "Candid smartphone photo of a fictional 28-year-old Black man with short curly hair, clean-shaven, a small gold stud earring in his left ear and a white shirt, outdoors in a park, soft daylight, looking at the camera, head and shoulders. Realistic everyday photo, not a celebrity.",
  },
  {
    id: "kvinna-31-lugg",
    label: "Kvinna 31, lugg",
    gender: "f",
    prompt:
      "Candid smartphone photo of a fictional 31-year-old East Asian woman with long straight black hair and blunt bangs, no glasses, light natural makeup and a beige sweater, in a cafe, natural light, looking at the camera, head and shoulders. Realistic everyday photo, not a celebrity.",
  },
  {
    id: "man-55-flint",
    label: "Man 55, flint och glasögon",
    gender: "m",
    prompt:
      "Candid smartphone photo of a fictional 55-year-old bald man with rectangular black glasses, a short grey goatee and a round face, wearing a navy polo shirt on a balcony, daylight, looking at the camera, head and shoulders. Realistic everyday photo, not a celebrity.",
  },
  {
    id: "kvinna-40-fraknar",
    label: "Kvinna 40, fräknar",
    gender: "f",
    prompt:
      "Candid smartphone photo of a fictional 40-year-old woman with curly shoulder-length red hair tied in a loose ponytail, many freckles, green eyes and a green knitted sweater, in a garden, natural light, looking at the camera, head and shoulders. Realistic everyday photo, not a celebrity.",
  },
];

const ENGINE_ORDER: PortraitEngine[] = PORTRAIT_ENGINES.map((e) => e.id);
const DESIGN_ID_RE = /^ptest-([a-z0-9]+)-(\d+)-(current|nbpro|nb2|seedream)$/;

function loadFaces(): Face[] {
  try {
    const raw = localStorage.getItem(FACES_STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as Face[]) : [];
    return Array.isArray(list) ? list.filter((f) => f && f.url && f.id) : [];
  } catch {
    return [];
  }
}

function saveFaces(faces: Face[]) {
  try {
    localStorage.setItem(FACES_STORAGE_KEY, JSON.stringify(faces));
  } catch {
    /* lagringen är bara en bekvämlighet */
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Hitta mallens första personlager (aiPhoto med referensbild) i template-JSON:en. */
function findAiPhotoLayer(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findAiPhotoLayer(n);
      if (hit) return hit;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const defaults = obj.defaults as Record<string, unknown> | undefined;
  if (
    obj.type === "aiPhoto" &&
    defaults &&
    ((Array.isArray(defaults.referenceImages) && defaults.referenceImages.length > 0) ||
      typeof defaults.referenceImageUrl === "string")
  ) {
    return obj;
  }
  for (const v of Object.values(obj)) {
    const hit = findAiPhotoLayer(v);
    if (hit) return hit;
  }
  return null;
}

function slotGender(slot: Slot): Gender | null {
  const s = `${slot.label} ${slot.position}`.toLowerCase();
  if (/drottning|queen|kvinna|woman|hon\b/.test(s)) return "f";
  if (/kung|king|man\b|han\b/.test(s)) return "m";
  return null;
}

function engineMeta(id: PortraitEngine) {
  return PORTRAIT_ENGINES.find((e) => e.id === id)!;
}

export default function PortraitTestPage() {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [faces, setFaces] = useState<Face[]>(() => loadFaces());
  const [selectedFaces, setSelectedFaces] = useState<Set<string>>(new Set());
  const [selectedHandles, setSelectedHandles] = useState<Set<string>>(new Set(HANDLES));
  const [selectedEngines, setSelectedEngines] = useState<Set<PortraitEngine>>(new Set(ENGINE_ORDER));
  const [matchGender, setMatchGender] = useState(true);
  const [creatingFaces, setCreatingFaces] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<GenerationRow[]>([]);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);

  useEffect(() => {
    saveFaces(faces);
  }, [faces]);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("product_configs")
        .select("shopify_handle,title,template")
        .in("shopify_handle", HANDLES);
      if (error) {
        toast.error("Kunde inte läsa mallarna", { description: error.message });
        return;
      }
      const out: TemplateInfo[] = [];
      for (const row of (data ?? []) as Array<{ shopify_handle: string; title: string; template: unknown }>) {
        const layer = findAiPhotoLayer(row.template);
        if (!layer) continue;
        const d = layer.defaults as Record<string, unknown>;
        const refs = (Array.isArray(d.referenceImages) ? (d.referenceImages as RefImage[]) : []).filter((r) => r?.url);
        if (refs.length === 0 && typeof d.referenceImageUrl === "string") refs.push({ url: d.referenceImageUrl });
        const mf = d.multiFaceSwap as { enabled?: boolean; slots?: Slot[] } | undefined;
        out.push({
          handle: row.shopify_handle,
          title: row.title,
          layerId: String(layer.id ?? "ai"),
          references: refs,
          swapPrompt: typeof d.swapPrompt === "string" ? d.swapPrompt : "",
          slots: mf?.enabled && Array.isArray(mf.slots) && mf.slots.length >= 2 ? mf.slots : null,
        });
      }
      out.sort((a, b) => HANDLES.indexOf(a.handle) - HANDLES.indexOf(b.handle));
      setTemplates(out);
    })();
  }, []);

  const loadResults = useCallback(async () => {
    setLoadingResults(true);
    try {
      const rows = await fetchPortraitTestGenerations();
      setResults(rows);
      setSelectedRun((cur) => {
        if (cur) return cur;
        const first = rows.map((r) => DESIGN_ID_RE.exec(r.design_id ?? "")?.[1]).find(Boolean);
        return first ?? null;
      });
    } catch (e) {
      toast.error("Kunde inte läsa testresultaten", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoadingResults(false);
    }
  }, []);

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  const createSyntheticFaces = async () => {
    setCreatingFaces(true);
    try {
      for (const sf of SYNTHETIC_FACES) {
        if (faces.some((f) => f.id === sf.id)) continue;
        const { data, error } = await supabase.functions.invoke("easel-swap-test", {
          body: {
            action: "run",
            model: "google/nano-banana-2",
            input: { prompt: sf.prompt, resolution: "1K", aspect_ratio: "3:4", output_format: "jpg" },
            filename: `testface-${sf.id}`,
          },
        });
        const url = (data as { url?: string } | null)?.url;
        if (error || !url) {
          toast.error(`Testansiktet "${sf.label}" kunde inte skapas`, {
            description: error?.message ?? JSON.stringify(data ?? {}).slice(0, 200),
          });
          continue;
        }
        setFaces((cur) => [...cur.filter((f) => f.id !== sf.id), { id: sf.id, url, label: sf.label, gender: sf.gender }]);
        setSelectedFaces((cur) => new Set(cur).add(sf.id));
      }
    } finally {
      setCreatingFaces(false);
    }
  };

  const uploadOwnFace = async (file: File, gender: Gender | undefined) => {
    try {
      const dataUrl = await fileToDataUrl(file);
      const id = `egen-${Date.now().toString(36)}`;
      const url = await uploadCartPreview(dataUrl, `ptest-face-${id}`);
      const label = file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Eget foto";
      setFaces((cur) => [...cur, { id, url, label, gender }]);
      setSelectedFaces((cur) => new Set(cur).add(id));
    } catch (e) {
      toast.error("Uppladdningen misslyckades", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  /** Bygg testfallen: enkla porträtt per ansikte och mall, par för parmallen. */
  const plannedCases = useMemo(() => {
    const chosen = faces.filter((f) => selectedFaces.has(f.id));
    const cases: Array<
      | { kind: "single"; label: string; template: TemplateInfo; face: Face }
      | { kind: "pair"; label: string; template: TemplateInfo; faces: Face[] }
    > = [];
    for (const t of templates) {
      if (!selectedHandles.has(t.handle) || t.references.length === 0) continue;
      if (t.slots) {
        if (t.slots.length !== 2) continue;
        const men = chosen.filter((f) => f.gender === "m");
        const women = chosen.filter((f) => f.gender === "f");
        const others = chosen.filter((f) => !f.gender);
        const pairs: Face[][] = [];
        for (let i = 0; i < Math.min(men.length, women.length, 2); i++) pairs.push([men[i], women[i]]);
        if (pairs.length === 0 && others.length >= 2) pairs.push([others[0], others[1]]);
        for (const pair of pairs) {
          // Paren är [man, kvinna]. Byt plats om mallens första slot är drottningen.
          const ordered = slotGender(t.slots[0]) === "f" ? [pair[1], pair[0]] : pair;
          cases.push({
            kind: "pair",
            label: `${t.title}: ${ordered.map((f) => f.label).join(" + ")}`,
            template: t,
            faces: ordered,
          });
        }
      } else {
        const wantGender: Gender | null = /drottning|queen/i.test(t.handle) ? "f" : /kung|king/i.test(t.handle) ? "m" : null;
        for (const f of chosen) {
          if (matchGender && wantGender && f.gender && f.gender !== wantGender) continue;
          cases.push({ kind: "single", label: `${t.title}: ${f.label}`, template: t, face: f });
        }
      }
    }
    return cases;
  }, [faces, selectedFaces, templates, selectedHandles, matchGender]);

  const engines = ENGINE_ORDER.filter((e) => selectedEngines.has(e));
  const estimatedCost = plannedCases.reduce(
    (sum, c) =>
      sum +
      engines.reduce((s, e) => s + (c.kind === "pair" ? engineMeta(e).costPairSek ?? engineMeta(e).costSek : engineMeta(e).costSek), 0),
    0,
  );

  const runTest = async () => {
    if (plannedCases.length === 0 || engines.length === 0) return;
    const runId = Date.now().toString(36);
    const allJobs: Array<Job & { run: () => Promise<void> }> = [];
    plannedCases.forEach((c, caseIdx) => {
      for (const engine of engines) {
        const designId = `ptest-${runId}-${caseIdx}-${engine}`;
        const key = designId;
        const run = async () => {
          const ref = c.template.references[0].url;
          const res =
            c.kind === "single"
              ? await supabase.functions.invoke("replicate-face-swap", {
                  body: {
                    referenceImageUrl: ref,
                    faceImageUrl: c.face.url,
                    prompt: c.template.swapPrompt,
                    subjectKind: "human",
                    designId,
                    sessionKey: PORTRAIT_TEST_SESSION_KEY,
                    humanEngine: engine,
                  },
                })
              : await supabase.functions.invoke("multi-face-swap", {
                  body: {
                    layerId: c.template.layerId,
                    referenceImageUrl: ref,
                    prompt: c.template.swapPrompt,
                    slots: c.template.slots!.map((s) => ({ id: s.id, position: s.position })),
                    portraits: Object.fromEntries(c.template.slots!.map((s, i) => [s.id, c.faces[i].url])),
                    designId,
                    sessionKey: PORTRAIT_TEST_SESSION_KEY,
                    humanEngine: engine,
                  },
                });
          const payload = res.data as { printFileUrl?: string; error?: string } | null;
          if (res.error || !payload?.printFileUrl) {
            throw new Error(res.error?.message ?? payload?.error ?? "inget resultat");
          }
        };
        allJobs.push({ key, caseLabel: c.label, engine, status: "väntar", run });
      }
    });

    setJobs(allJobs.map((j) => ({ key: j.key, caseLabel: j.caseLabel, engine: j.engine, status: j.status })));
    setSelectedRun(runId);
    setRunning(true);
    const update = (key: string, patch: Partial<Job>) =>
      setJobs((cur) => cur.map((j) => (j.key === key ? { ...j, ...patch } : j)));

    // Två samtidiga anrop: Replicate stryper vid lågt saldo och funktionerna
    // har egna omförsök, så fler parallella ger bara köer och 429:or.
    let next = 0;
    const worker = async () => {
      while (next < allJobs.length) {
        const job = allJobs[next++];
        update(job.key, { status: "kör" });
        try {
          await job.run();
          update(job.key, { status: "klar" });
        } catch (e) {
          update(job.key, { status: "fel", message: e instanceof Error ? e.message : String(e) });
        }
        void loadResults();
      }
    };
    await Promise.all([worker(), worker()]);
    setRunning(false);
    await loadResults();
    toast.success("Testkörningen är klar");
  };

  // Gruppera resultaten: körning → testfall → motor.
  const runs = useMemo(() => {
    const byRun = new Map<string, { createdAt: string; cases: Map<number, Map<PortraitEngine, GenerationRow>> }>();
    for (const r of results) {
      const m = DESIGN_ID_RE.exec(r.design_id ?? "");
      if (!m) continue;
      const [, runId, caseIdx, engine] = m;
      const run = byRun.get(runId) ?? { createdAt: r.created_at, cases: new Map() };
      if (r.created_at < run.createdAt) run.createdAt = r.created_at;
      const c = run.cases.get(Number(caseIdx)) ?? new Map();
      const prev = c.get(engine as PortraitEngine);
      if (!prev || prev.created_at < r.created_at) c.set(engine as PortraitEngine, r);
      run.cases.set(Number(caseIdx), c);
      byRun.set(runId, run);
    }
    return [...byRun.entries()].sort((a, b) => (a[1].createdAt < b[1].createdAt ? 1 : -1));
  }, [results]);

  const currentRun = runs.find(([id]) => id === selectedRun) ?? runs[0] ?? null;

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-[1400px] space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link to="/admin/analytics" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
              <ArrowLeft className="h-4 w-4" /> Analytics
            </Link>
            <h1 className="mt-1 text-2xl font-semibold">Porträttest: jämför motorer</h1>
            <p className="text-sm text-muted-foreground">
              Samma foto genom alla motorer. Bara för admin; kunderna påverkas inte och testerna räknas inte i analysen.
            </p>
          </div>
        </header>

        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold">1. Testfoton</h2>
          <p className="text-sm text-muted-foreground">
            Fiktiva personer skapade med AI (inga riktiga kunder), eller ett eget foto. Använd bara foton på dig själv
            eller vuxna som har sagt ja.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={createSyntheticFaces} disabled={creatingFaces}>
              {creatingFaces ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
              Skapa 6 fiktiva testpersoner (ca 4 kr)
            </Button>
            {(["m", "f"] as Gender[]).map((g) => (
              <label key={g} className="inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                <ImagePlus className="mr-2 h-4 w-4" />
                Ladda upp eget foto ({g === "m" ? "man" : "kvinna"})
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadOwnFace(f, g);
                    e.target.value = "";
                  }}
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            {faces.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedFaces((cur) => toggle(cur, f.id))}
                className={`w-28 overflow-hidden rounded-md border-2 text-left ${selectedFaces.has(f.id) ? "border-primary" : "border-transparent opacity-60"}`}
              >
                <img src={f.url} alt={f.label} className="h-36 w-28 object-cover" />
                <div className="px-1 py-0.5 text-xs">{f.label}</div>
              </button>
            ))}
            {faces.length === 0 && <p className="text-sm text-muted-foreground">Inga testfoton ännu.</p>}
          </div>
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold">2. Mallar och motorer</h2>
          <div className="flex flex-wrap gap-4 text-sm">
            {templates.map((t) => (
              <label key={t.handle} className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedHandles.has(t.handle)}
                  onChange={() => setSelectedHandles((cur) => toggle(cur, t.handle))}
                />
                {t.title}
                {t.slots ? ` (${t.slots.map((s) => s.label).join(" + ")})` : ""}
              </label>
            ))}
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={matchGender} onChange={() => setMatchGender((v) => !v)} />
              Män som kung, kvinnor som drottning
            </label>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            {PORTRAIT_ENGINES.map((e) => (
              <label key={e.id} className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedEngines.has(e.id)}
                  onChange={() => setSelectedEngines((cur) => toggle(cur, e.id))}
                />
                {e.label} (ca {e.costSek.toLocaleString("sv-SE")} kr)
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={runTest} disabled={running || plannedCases.length === 0 || engines.length === 0}>
              {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Kör {plannedCases.length} testfall × {engines.length} motorer
            </Button>
            <span className="text-sm text-muted-foreground">
              Uppskattad kostnad ca {Math.round(estimatedCost)} kr. Låt sidan vara öppen tills körningen är klar.
            </span>
          </div>
          {jobs.length > 0 && (
            <ul className="grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {jobs.map((j) => (
                <li key={j.key} className="truncate">
                  <span
                    className={
                      j.status === "klar"
                        ? "text-green-700"
                        : j.status === "fel"
                          ? "text-red-700"
                          : j.status === "kör"
                            ? "text-amber-700"
                            : "text-muted-foreground"
                    }
                  >
                    {j.status}
                  </span>{" "}
                  {j.caseLabel} · {engineMeta(j.engine).label}
                  {j.message ? ` · ${j.message}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-semibold">3. Resultat</h2>
            <select
              className="rounded-md border px-2 py-1 text-sm"
              value={currentRun?.[0] ?? ""}
              onChange={(e) => setSelectedRun(e.target.value)}
            >
              {runs.map(([id, r]) => (
                <option key={id} value={id}>
                  {new Date(r.createdAt).toLocaleString("sv-SE")} · {r.cases.size} testfall
                </option>
              ))}
            </select>
            <Button variant="ghost" size="sm" onClick={() => void loadResults()} disabled={loadingResults}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loadingResults ? "animate-spin" : ""}`} /> Uppdatera
            </Button>
          </div>

          {!currentRun && <p className="text-sm text-muted-foreground">Inga testkörningar ännu.</p>}

          {currentRun && (
            <div className="space-y-6">
              {[...currentRun[1].cases.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([caseIdx, byEngine]) => {
                  const first = [...byEngine.values()][0];
                  const photos = (first?.input_image_urls?.length ? first.input_image_urls : [first?.input_image_url]).filter(
                    (u): u is string => !!u,
                  );
                  const isPair = photos.length > 1;
                  return (
                    <div key={caseIdx} className="rounded-lg border p-3">
                      <div className="flex gap-3 overflow-x-auto">
                        <div className="w-40 shrink-0 space-y-2">
                          <div className="text-xs font-medium">Foto{isPair ? "n" : ""}</div>
                          {photos.map((u) => (
                            <a key={u} href={u} target="_blank" rel="noreferrer">
                              <img src={u} alt="Testfoto" className="mb-1 w-full rounded object-cover" />
                            </a>
                          ))}
                          {first?.reference_image_url && (
                            <>
                              <div className="text-xs font-medium">Målningen</div>
                              <a href={first.reference_image_url} target="_blank" rel="noreferrer">
                                <img src={first.reference_image_url} alt="Målningen" className="w-full rounded object-cover" />
                              </a>
                            </>
                          )}
                        </div>
                        {ENGINE_ORDER.map((engine) => {
                          const g = byEngine.get(engine);
                          const meta = engineMeta(engine);
                          const cost = isPair ? meta.costPairSek ?? meta.costSek : meta.costSek;
                          return (
                            <div key={engine} className="w-72 shrink-0 space-y-1">
                              <div className="text-xs font-medium">{meta.label}</div>
                              {g?.status === "succeeded" && g.output_image_url ? (
                                <a href={g.output_image_url} target="_blank" rel="noreferrer">
                                  <img src={g.output_image_url} alt={meta.label} className="w-full rounded" />
                                </a>
                              ) : (
                                <div className="flex h-72 items-center justify-center rounded bg-muted p-2 text-center text-xs text-muted-foreground">
                                  {!g ? "Ej körd" : g.status === "failed" ? `Fel: ${g.error ?? "okänt"}` : "Pågår…"}
                                </div>
                              )}
                              <div className="text-xs text-muted-foreground">
                                {g?.duration_ms ? `${Math.round(g.duration_ms / 1000)} s · ` : ""}ca{" "}
                                {cost.toLocaleString("sv-SE")} kr
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
