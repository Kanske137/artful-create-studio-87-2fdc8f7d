// Per-photo-layer AI-style picker. Visible when a photo is uploaded for the
// given layer and the active product template defines `aiStyles`. Each preset
// triggers the `replicate-style` edge function which returns a `printFileUrl`
// already uploaded to the print-files bucket.
//
// Cache: results are keyed by (photoHash, presetId) where photoHash is a
// SHA-256 of the file bytes. This survives URL churn (re-uploads create new
// paths) and full page reloads, and even works across photo layers when the
// customer happens to upload the same image twice.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/stores/editorStore";
import { useAiBusyStore, useIsAnyAiBusy } from "@/stores/aiBusyStore";
import { supabase } from "@/integrations/supabase/client";
import { uploadCartPreview } from "@/lib/upload-preview";
import { getSessionKey } from "@/lib/analytics";
import {
  ensureSubscriberGatePassed,
  invokeWithSubscriberGate,
  markFreeGenerationUsed,
} from "@/lib/subscriber-gate";
import { hashFile } from "@/lib/ai-cache-storage";
import type { AiStylePreset } from "@/lib/template-schema";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AiProgress } from "./AiProgress";
import { GenerationFeedback } from "./GenerationFeedback";
import { invalidatePreviousResults, PreviousResults, PreviousUploads } from "./PreviousResults";

interface Props {
  presets: AiStylePreset[];
  /** Photo layer this AI section operates on. */
  layerId: string;
}

/** Convert a Blob to a JPEG dataURL via canvas (Replicate prefers HTTPS URLs,
 *  but we stage the original via uploadCartPreview which accepts a dataURL). */
async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("blobToDataUrl failed"));
    r.readAsDataURL(blob);
  });
}

export function AiStyleSection({ presets, layerId }: Props) {
  const { t } = useTranslation();
  const source = useEditorStore((s) => s.photoSources[layerId]);
  const aiPrintFileUrl = useEditorStore((s) => s.photoAiResults[layerId] ?? null);
  const setPhotoHashFor = useEditorStore((s) => s.setPhotoHashFor);
  const setPhotoSourceFor = useEditorStore((s) => s.setPhotoSourceFor);
  const setOriginalPhotoUrlFor = useEditorStore((s) => s.setOriginalPhotoUrlFor);
  const setAiPrintFileUrlFor = useEditorStore((s) => s.setAiPrintFileUrlFor);
  const clearAiResultOnlyFor = useEditorStore((s) => s.clearAiResultOnlyFor);
  const addAiResultToCache = useEditorStore((s) => s.addAiResultToCache);
  const getCachedAiResult = useEditorStore((s) => s.getCachedAiResult);
  const listAiResultsForPhoto = useEditorStore((s) => s.listAiResultsForPhoto);
  const clearAiResult = useEditorStore((s) => s.clearAiResult);
  // Subscribe to the cache so the history list re-renders when entries change.
  const aiResultCache = useEditorStore((s) => s.aiResultCache);

  const photoFile = source?.file ?? null;
  const photoHash = source?.hash ?? null;
  const originalPhotoUrl = source?.originalUrl ?? null;

  const [busyId, setBusyId] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);

  // Compute the photo hash whenever the file changes. Cheap (a few ms for
  // typical phone photos) and runs only once per upload thanks to setPhotoHash
  // bailing out when the hash is unchanged.
  useEffect(() => {
    if (!photoFile) return;
    let cancelled = false;
    hashFile(photoFile)
      .then((h) => {
        if (!cancelled) setPhotoHashFor(layerId, h);
      })
      .catch((e) => console.warn("[AiStyle] hashFile failed", e));
    return () => {
      cancelled = true;
    };
  }, [photoFile, layerId, setPhotoHashFor]);

  const ensureUploadedPhotoUrl = async (): Promise<string | null> => {
    if (originalPhotoUrl) return originalPhotoUrl;
    if (!photoFile) return null;
    try {
      const dataUrl = await blobToDataUrl(photoFile);
      const designId = `src-${(crypto as any)?.randomUUID?.() ?? Date.now()}`;
      const url = await uploadCartPreview(dataUrl, designId);
      setOriginalPhotoUrlFor(layerId, url);
      return url;
    } catch (e) {
      console.error("[AiStyle] upload failed", e);
      toast.error("Kunde inte ladda upp bilden");
      return null;
    }
  };

  const ensurePhotoHash = async (): Promise<string | null> => {
    if (photoHash) return photoHash;
    if (!photoFile) return null;
    try {
      const h = await hashFile(photoFile);
      setPhotoHashFor(layerId, h);
      return h;
    } catch (e) {
      console.warn("[AiStyle] hashFile failed", e);
      return null;
    }
  };

  const applyStyle = async (preset: AiStylePreset) => {
    if (!photoFile) {
      toast.error("Ladda upp en bild först");
      return;
    }
    // Gate-pre-flight FÖRE busy-overlayen: dialogen ska aldrig tävla med
    // spinnern, och flödet fortsätter automatiskt efter registrering.
    if (!(await ensureSubscriberGatePassed())) return;

    const jobId = `ai-style:${layerId}:${preset.id}`;
    const { startAiJob, updateAiJobStage, endAiJob } = useAiBusyStore.getState();
    setBusyId(preset.id);
    setStage("Förbereder din bild…");
    startAiJob(jobId, { label: t("ai.creatingImage"), expectedSeconds: 12, stage: "Förbereder din bild…" });
    try {
      // Resolve a stable cache key first (the hash) — never the upload URL.
      const hash = await ensurePhotoHash();
      if (hash) {
        const cached = getCachedAiResult(hash, preset.id);
        if (cached) {
          setAiPrintFileUrlFor(layerId, cached);
          toast.success(`Stil "${preset.label}" återanvänd`);
          return;
        }
      }

      // Cache miss → ensure the photo is uploaded so Replicate can fetch it.
      setStage("Laddar upp din bild…");
      updateAiJobStage(jobId, "Laddar upp din bild…");
      const imageUrl = await ensureUploadedPhotoUrl();
      if (!imageUrl) return;

      const designId = (crypto as any)?.randomUUID?.() ?? `${Date.now()}`;
      setStage("Skapar din bild…");
      updateAiJobStage(jobId, "Skapar din bild…");
      const res = await invokeWithSubscriberGate<{ printFileUrl?: string }>("replicate-style", {
        imageUrl,
        prompt: preset.prompt,
        designId,
        sessionKey: getSessionKey(),
      });
      if (res.handled) return;
      const { data, error } = res;
      if (error) throw error;
      setStage("Hämtar resultat…");
      updateAiJobStage(jobId, "Hämtar resultat…");
      const printFileUrl = (data as { printFileUrl?: string })?.printFileUrl;
      if (!printFileUrl) throw new Error("Tjänsten returnerade ingen bild");
      setAiPrintFileUrlFor(layerId, printFileUrl);
      if (hash) addAiResultToCache(hash, preset.id, preset.label, printFileUrl);
      markFreeGenerationUsed();
      invalidatePreviousResults();
      toast.success(`Stil "${preset.label}" tillämpad`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Okänt fel";
      console.error("[AiStyle] failed", e);
      toast.error("Kunde inte tillämpa stilen", { description: msg });
    } finally {
      setBusyId(null);
      setStage(null);
      endAiJob(jobId);
    }
  };

  const undoAi = () => {
    clearAiResultOnlyFor(layerId);
  };

  if (!photoFile) {
    // Demo (Paket D2): förberett exempelresultat när mallen saknar förhands-
    // bild. Spärras alltid från beställning i orderBlockReason.
    const demoUrl =
      (useEditorStore
        .getState()
        .templateLayers()
        .find((l) => l.id === layerId)?.defaults as { demoResultUrl?: string } | undefined)
        ?.demoResultUrl ?? null;
    const demoActive = !!demoUrl && aiPrintFileUrl === demoUrl;
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Ladda upp en bild först för att kunna välja AI-stil.
        </p>
        {demoUrl && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() =>
              demoActive ? clearAiResultOnlyFor(layerId) : setAiPrintFileUrlFor(layerId, demoUrl)
            }
          >
            {demoActive ? t("demo.remove") : t("demo.tryButton")}
          </Button>
        )}
        {/* Tidigare uppladdade foton — klick använder fotot här direkt. */}
        <PreviousUploads
          onPick={(f) => setPhotoSourceFor(layerId, f, URL.createObjectURL(f))}
        />
      </div>
    );
  }

  const visiblePresets = presets.filter((p) => p.enabled !== false);
  const singlePreset = visiblePresets.length === 1 ? visiblePresets[0] : null;
  const autoAppliedRef = useRef<string | null>(null);

  // När bara EN stil är aktiverad: dölj väljaren men applicera stilen automatiskt
  // så fort kunden har laddat upp en bild (cache används om möjligt).
  useEffect(() => {
    if (!singlePreset) return;
    if (!photoFile || !photoHash) return;
    if (aiPrintFileUrl) return;
    if (busyId) return;
    const key = `${photoHash}::${singlePreset.id}`;
    if (autoAppliedRef.current === key) return;
    autoAppliedRef.current = key;
    void applyStyle(singlePreset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singlePreset?.id, photoFile, photoHash, aiPrintFileUrl, busyId]);

  if (visiblePresets.length === 0) return null;
  if (singlePreset) {
    // Visa endast progress vid auto-körning; ingen väljare/historik.
    return (
      <AiProgress
        active={busyId !== null}
        expectedSeconds={12}
        label="Skapar bild"
        stage={stage}
      />
    );
  }

  // History for the active photo (driven by hash, not URL).
  const history = photoHash ? listAiResultsForPhoto(photoHash) : [];
  // Cheap subscription tickle (avoid lint warning for unused var).
  void aiResultCache;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        Välj stil
      </div>
      <div className="grid grid-cols-3 gap-2">
        {visiblePresets.map((p) => {
          const busy = busyId === p.id;
          const cachedUrl = photoHash ? getCachedAiResult(photoHash, p.id) : null;
          const isActive = !!cachedUrl && aiPrintFileUrl === cachedUrl;
          return (
            <button
              key={p.id}
              type="button"
              disabled={!!busyId}
              onClick={() => applyStyle(p)}
              className={cn(
                "group relative aspect-square rounded-xl overflow-hidden ring-1 ring-border bg-muted hover:-translate-y-0.5 transition disabled:opacity-50 disabled:translate-y-0",
                isActive && "ring-2 ring-primary",
              )}
            >
              {p.thumbnailUrl ? (
                <img
                  src={p.thumbnailUrl}
                  alt={p.label}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-muted to-accent/30 flex items-center justify-center">
                  <Sparkles className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              {busy && (
                <div className="absolute inset-0 bg-background/70 backdrop-blur-sm flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
              {cachedUrl && !busy && (
                <span className="absolute top-1 right-1 bg-primary text-primary-foreground text-[9px] font-semibold px-1.5 py-0.5 rounded-full leading-none">
                  ✓
                </span>
              )}
              <span className="absolute bottom-0 inset-x-0 bg-background/85 backdrop-blur-sm text-[10px] py-1 text-center font-medium">
                {p.label}
              </span>
            </button>
          );
        })}
      </div>

      <AiProgress
        active={busyId !== null}
        expectedSeconds={12}
        label="Skapar bild"
        stage={stage}
      />

      {history.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Dina provade stilar
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {history.map((entry) => {
              const isActive = aiPrintFileUrl === entry.url;
              return (
                <div key={entry.presetId} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setAiPrintFileUrlFor(layerId, entry.url);
                      toast.success(`Stil "${entry.presetLabel}" återanvänd`);
                    }}
                    className={cn(
                      "block w-16 h-16 rounded-lg overflow-hidden ring-1 ring-border bg-muted hover:-translate-y-0.5 transition",
                      isActive && "ring-2 ring-primary",
                    )}
                    title={entry.presetLabel}
                  >
                    <img
                      src={entry.url}
                      alt={entry.presetLabel}
                      className="w-full h-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearAiResult(entry.photoHash, entry.presetId);
                    }}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-background/90 ring-1 ring-border flex items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label="Ta bort från historik"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {aiPrintFileUrl && (
        <>
          <GenerationFeedback resultUrl={aiPrintFileUrl} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={undoAi}
            className="w-full"
          >
            <Undo2 className="h-3.5 w-3.5 mr-1.5" />
            Återgå till foto utan stil
          </Button>
        </>
      )}

      {/* Tidigare AI-stilresultat + uppladdade foton (sparade på servern). */}
      <PreviousResults
        subjectKinds={["style"]}
        activeUrl={aiPrintFileUrl}
        onPick={(url) => setAiPrintFileUrlFor(layerId, url)}
      />
      <PreviousUploads
        onPick={(f) => setPhotoSourceFor(layerId, f, URL.createObjectURL(f))}
      />
    </div>
  );
}
