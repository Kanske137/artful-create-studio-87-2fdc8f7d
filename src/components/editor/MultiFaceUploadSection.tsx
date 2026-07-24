// Customer-side multi-face-swap section. Rendered INSTEAD of `AiPhotoSection`
// when the admin has enabled `multiFaceSwap` on the aiPhoto layer. The legacy
// single-face flow stays untouched — when the flag is absent or false the
// editor mounts the original `AiPhotoSection` exactly as before.
//
// The customer uploads one portrait per slot (2-4 slots). On "Skapa" we call
// the NEW `multi-face-swap` edge function with reference + all portraits, and
// write the result to `aiPhotoResults[layer.id]` — the same store field
// single-face writes to — so preview/snapshot/print/cart flows are oblivious
// to the difference.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import { GenerationFeedback } from "./GenerationFeedback";
import { invalidatePreviousResults, PreviousResults, PreviousUploads } from "./PreviousResults";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useEditorStore } from "@/stores/editorStore";
import { useAiBusyStore } from "@/stores/aiBusyStore";
import { supabase } from "@/integrations/supabase/client";
import { uploadCartPreview } from "@/lib/upload-preview";
import { getSessionKey, track } from "@/lib/analytics";
import {
  ensureSubscriberGatePassed,
  invokeWithSubscriberGate,
  markFreeGenerationUsed,
} from "@/lib/subscriber-gate";
import { hashFile } from "@/lib/ai-cache-storage";
import {
  loadMultiFaceCache,
  saveMultiFaceCache,
  makeMultiFaceKey,
  type MultiFaceCacheEntry,
} from "@/lib/multi-face-cache";
import type { TemplateLayer } from "@/lib/template-schema";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type AiPhotoLayer = Extract<TemplateLayer, { type: "aiPhoto" }>;

interface Props {
  layer: AiPhotoLayer;
  heading?: string | null;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic";
const MAX_BYTES = 25 * 1024 * 1024;

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("blobToDataUrl failed"));
    r.readAsDataURL(blob);
  });
}

export function MultiFaceUploadSection({ layer, heading }: Props) {
  const { t } = useTranslation();
  const cfg = layer.defaults.multiFaceSwap;
  const slots = cfg?.slots ?? [];

  // Resolve admin-configured reference subjects — mirrors AiPhotoSection so
  // the customer can pick among multiple references (e.g. portrait/landscape
  // variants or alternative scenes), exactly like the single-face flow.
  const allReferenceImages = (() => {
    const list = layer.defaults.referenceImages ?? [];
    if (list.length > 0) return list;
    if (layer.defaults.referenceImageUrl) {
      return [{ id: "legacy", url: layer.defaults.referenceImageUrl, label: undefined, orientation: "any" as const }];
    }
    return [];
  })();
  const editorOrientation = useEditorStore((s) => s.orientation);
  const referenceImages = allReferenceImages.filter((r) => {
    const o = (r as { orientation?: string }).orientation ?? "any";
    return o === "any" || o === editorOrientation;
  });
  const showSubjectPicker = referenceImages.length >= 2;

  const aiPhotoSelectedRefUrl = useEditorStore((s) => s.aiPhotoSelectedRefUrl);
  const setAiPhotoSelectedRef = useEditorStore((s) => s.setAiPhotoSelectedRef);
  const selectedRefUrlFromStore = aiPhotoSelectedRefUrl[layer.id] ?? null;
  const selectedRef =
    referenceImages.find((r) => r.url === selectedRefUrlFromStore) ?? referenceImages[0] ?? null;
  const refUrl = selectedRef?.url ?? layer.defaults.referenceImageUrl ?? null;

  const portraitsAll = useEditorStore((s) => s.multiFacePortraits);
  const setMultiFacePortrait = useEditorStore((s) => s.setMultiFacePortrait);
  const setMultiFacePortraitHash = useEditorStore((s) => s.setMultiFacePortraitHash);
  const setMultiFacePortraitUploadedUrl = useEditorStore((s) => s.setMultiFacePortraitUploadedUrl);
  const setAiPhotoResult = useEditorStore((s) => s.setAiPhotoResult);
  const aiPhotoResults = useEditorStore((s) => s.aiPhotoResults);

  const layerPortraits = portraitsAll[layer.id] ?? {};
  const result = aiPhotoResults[layer.id] ?? null;

  const [busy, setBusy] = useState(false);
  const expectedSeconds = 30;

  const cacheRef = useRef<Record<string, MultiFaceCacheEntry>>(loadMultiFaceCache());

  // Heal selection when references or orientation change.
  useEffect(() => {
    if (referenceImages.length === 0) return;
    const stored = aiPhotoSelectedRefUrl[layer.id];
    if (!stored || !referenceImages.some((r) => r.url === stored)) {
      setAiPhotoSelectedRef(layer.id, referenceImages[0].url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer.id, editorOrientation, referenceImages.map((r) => r.url).join("|")]);

  // When the selected reference changes, swap the displayed result to the
  // cached one for the new (refUrl, portraits) combination — or clear it so
  // the customer can re-tap "Skapa" against the new reference.
  useEffect(() => {
    if (!refUrl) return;
    const hashEntries = slots
      .map((s) => ({ slotId: s.id, hash: layerPortraits[s.id]?.hash ?? "" }))
      .filter((e) => e.hash);
    if (hashEntries.length !== slots.length) return;
    const key = makeMultiFaceKey(layer.id, refUrl, hashEntries);
    const cached = cacheRef.current[key];
    if (cached?.url) {
      if (result !== cached.url) setAiPhotoResult(layer.id, cached.url);
    } else if (result) {
      setAiPhotoResult(layer.id, null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refUrl]);

  // Lazy-hash newly uploaded portraits.
  useEffect(() => {
    for (const slot of slots) {
      const entry = layerPortraits[slot.id];
      if (entry?.file && !entry.hash) {
        hashFile(entry.file)
          .then((h) => setMultiFacePortraitHash(layer.id, slot.id, h))
          .catch((e) => console.warn("[MultiFace] hashFile failed", e));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer.id, slots.map((s) => `${s.id}:${layerPortraits[s.id]?.file?.name ?? ""}`).join("|")]);

  if (!cfg?.enabled || slots.length < 2) {
    return null;
  }

  const onFiles = (slotId: string, files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!f.type.match(/^image\//)) {
      toast.error(t("photo.errorOnlyImages"));
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error(t("photo.errorTooLarge"), { description: t("photo.errorTooLargeHint") });
      return;
    }
    const url = URL.createObjectURL(f);
    setMultiFacePortrait(layer.id, slotId, f, url);
  };

  const ensureUploaded = async (slotId: string): Promise<string | null> => {
    const entry = layerPortraits[slotId];
    if (!entry?.file) return null;
    if (entry.uploadedUrl) return entry.uploadedUrl;
    try {
      const dataUrl = await blobToDataUrl(entry.file);
      const designId = `multi-${slotId}-${(crypto as { randomUUID?: () => string }).randomUUID?.() ?? Date.now()}`;
      const url = await uploadCartPreview(dataUrl, designId);
      setMultiFacePortraitUploadedUrl(layer.id, slotId, url);
      return url;
    } catch (e) {
      console.error("[MultiFace] upload failed", e);
      return null;
    }
  };

  const ensureHash = async (slotId: string): Promise<string | null> => {
    const entry = layerPortraits[slotId];
    if (!entry?.file) return null;
    if (entry.hash) return entry.hash;
    try {
      const h = await hashFile(entry.file);
      setMultiFacePortraitHash(layer.id, slotId, h);
      return h;
    } catch {
      return null;
    }
  };

  const allFilled = slots.every((s) => !!layerPortraits[s.id]?.file);

  const runSwap = async (opts: { force?: boolean } = {}) => {
    if (!refUrl) {
      toast.error(t("aiPhoto.missingReference"));
      return;
    }
    if (!allFilled) {
      toast.error(t("multiFace.allRequired"));
      return;
    }
    // Gate-pre-flight FÖRE busy-overlayen: dialogen ska aldrig tävla med
    // spinnern, och flödet fortsätter automatiskt efter registrering.
    if (!(await ensureSubscriberGatePassed())) return;
    setBusy(true);
    const jobId = `ai-multiface:${layer.id}`;
    const { startAiJob, updateAiJobStage, endAiJob } = useAiBusyStore.getState();
    startAiJob(jobId, {
      label: t("ai.creatingImage"),
      expectedSeconds,
      stage: t("ai.stagePrep"),
    });
    try {
      // Compute hashes for cache key.
      const hashEntries: Array<{ slotId: string; hash: string }> = [];
      for (const s of slots) {
        const h = await ensureHash(s.id);
        if (!h) throw new Error("hash failed");
        hashEntries.push({ slotId: s.id, hash: h });
      }
      const key = makeMultiFaceKey(layer.id, refUrl, hashEntries);
      if (!opts.force) {
        const cached = cacheRef.current[key];
        if (cached?.url) {
          setAiPhotoResult(layer.id, cached.url);
          toast.success(t("aiPhoto.ready"));
          return;
        }
      }

      updateAiJobStage(jobId, t("ai.stageUpload"));
      // Upload all portraits in parallel.
      const portraitsByID: Record<string, string> = {};
      await Promise.all(
        slots.map(async (s) => {
          const url = await ensureUploaded(s.id);
          if (!url) throw new Error(`upload failed for slot ${s.id}`);
          portraitsByID[s.id] = url;
        }),
      );

      updateAiJobStage(jobId, t("ai.stageCreate"));
      const designId = `multi-${(crypto as { randomUUID?: () => string }).randomUUID?.() ?? Date.now()}`;
      console.info("[MultiFace] invoking multi-face-swap", {
        layerId: layer.id,
        referenceImageUrl: refUrl,
        slots: slots.map((s) => s.id),
        portraitsByID,
      });
      const res = await invokeWithSubscriberGate<{
        printFileUrl?: string;
        error?: string;
        fallback?: boolean;
        userMessage?: string;
      }>("multi-face-swap", {
        layerId: layer.id,
        referenceImageUrl: refUrl,
        prompt: layer.defaults.swapPrompt,
        slots: slots.map((s) => ({ id: s.id, position: s.position })),
        portraits: portraitsByID,
        designId,
        sessionKey: getSessionKey(),
      });
      if (res.handled) return;
      const { data, error } = res;
      if (error) throw error;
      updateAiJobStage(jobId, t("ai.stageFetch"));
      const payload = data as {
        printFileUrl?: string;
        error?: string;
        fallback?: boolean;
        userMessage?: string;
      };
      if (payload?.error) {
        const friendly = payload.userMessage ?? t("aiPhoto.friendlyFailed");
        toast.error(t("aiPhoto.failed"), { description: friendly });
        return;
      }
      const printFileUrl = payload?.printFileUrl;
      if (!printFileUrl) throw new Error(t("ai.noResult"));
      setAiPhotoResult(layer.id, printFileUrl);
      // Persist cache.
      cacheRef.current = {
        ...cacheRef.current,
        [key]: {
          url: printFileUrl,
          layerId: layer.id,
          cacheKey: key,
          timestamp: Date.now(),
        },
      };
      saveMultiFaceCache(cacheRef.current);
      markFreeGenerationUsed();
      invalidatePreviousResults();
      toast.success(t("aiPhoto.ready"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("common.unknownError");
      console.error("[MultiFace] swap failed", e);
      toast.error(t("aiPhoto.failed"), { description: msg });
    } finally {
      setBusy(false);
      endAiJob(jobId);
    }
  };

  return (
    <div className="space-y-3">
      {heading && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {heading}
        </h4>
      )}

      {/* Stegindikator — gör flödet självklart, särskilt på mobil. */}
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {t("steps.flow")}
      </p>

      {!refUrl && (
        <p className="text-xs text-destructive">{t("aiPhoto.notConfigured")}</p>
      )}

      {showSubjectPicker && (
        <div className="space-y-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("aiPhoto.chooseSubject")}
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {referenceImages.map((r) => {
              const isActive = (selectedRef?.url ?? null) === r.url;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setAiPhotoSelectedRef(layer.id, r.url)}
                  className={cn(
                    "relative aspect-square rounded-xl overflow-hidden ring-1 ring-border bg-muted transition hover:-translate-y-0.5",
                    isActive && "ring-2 ring-primary",
                  )}
                >
                  <img src={r.url} alt={r.label ?? ""} className="w-full h-full object-cover" />
                  {r.label && (
                    <span className="absolute bottom-0 inset-x-0 bg-background/85 backdrop-blur-sm text-[10px] py-1 text-center font-medium">
                      {r.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Bildkrav — synligt vid själva uppladdningsrutorna, inte bara i guiden. */}
      <p className="text-[11px] text-muted-foreground">{t("multiFace.uploadRequirements")}</p>

      <div className="grid grid-cols-1 gap-3">
        {slots.map((slot) => (
          <MultiFaceSlot
            key={slot.id}
            slotId={slot.id}
            label={slot.label}
            entry={layerPortraits[slot.id] ?? null}
            onFiles={(fl) => onFiles(slot.id, fl)}
            onRemove={() => setMultiFacePortrait(layer.id, slot.id, null, null)}
          />
        ))}
      </div>

      <Button
        type="button"
        onClick={() => runSwap({ force: !!result })}
        disabled={!allFilled || !refUrl || busy}
        className="w-full"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {t("multiFace.creating")}
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4 mr-2" />
            {result ? t("multiFace.recreate") : t("multiFace.create")}
          </>
        )}
      </Button>

      {result && !busy && <GenerationFeedback resultUrl={result} />}

      {/* Tidigare bilder för samma referenser — klick återanvänder gratis. */}
      <PreviousResults
        referenceUrls={[...referenceImages.map((r) => r.url), ...(refUrl ? [refUrl] : [])]}
        activeUrl={result}
        onPick={(url) => setAiPhotoResult(layer.id, url)}
      />

      {/* Tidigare uppladdade foton — fyller första lediga porträttplatsen. */}
      <PreviousUploads
        onPick={(f) => {
          const empty = slots.find((s) => !layerPortraits[s.id]?.file);
          if (!empty) {
            toast.info(t("previousUploads.allSlotsFull"));
            return;
          }
          setMultiFacePortrait(layer.id, empty.id, f, URL.createObjectURL(f));
        }}
      />

      {(() => {
        const history = Object.values(cacheRef.current)
          .filter((e) => e.layerId === layer.id)
          .sort((a, b) => b.timestamp - a.timestamp);
        if (history.length === 0) return null;
        return (
          <div className="space-y-2 pt-1">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {t("aiPhoto.previousVersions")}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {history.map((entry) => {
                const isActive = result === entry.url;
                return (
                  <button
                    key={entry.cacheKey}
                    type="button"
                    onClick={() => {
                      setAiPhotoResult(layer.id, entry.url);
                      toast.success(t("aiPhoto.reused"));
                    }}
                    className={cn(
                      "block w-16 h-16 shrink-0 rounded-lg overflow-hidden ring-1 ring-border bg-muted hover:-translate-y-0.5 transition",
                      isActive && "ring-2 ring-primary",
                    )}
                  >
                    <img src={entry.url} alt="" className="w-full h-full object-cover" />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {!allFilled && (
        <p className="text-[11px] text-muted-foreground text-center">
          {t("multiFace.allRequired")}
        </p>
      )}
    </div>
  );
}

function MultiFaceSlot({
  slotId,
  label,
  entry,
  onFiles,
  onRemove,
}: {
  slotId: string;
  label: string;
  entry: { previewUrl: string } | null;
  onFiles: (files: FileList | null) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {t("multiFace.uploadFor", { label })}
      </Label>
      {!entry ? (
        <button
          type="button"
          onClick={() => {
            track("photo_picker_opened");
            inputRef.current?.click();
          }}
          className={cn(
            "w-full h-28 rounded-2xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-1.5 transition hover:bg-accent/30",
          )}
        >
          <Upload className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium">{t("photo.uploadCta")}</span>
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <div className="relative rounded-xl overflow-hidden border bg-muted aspect-square w-20 shrink-0">
            <img src={entry.previewUrl} alt={label} className="w-full h-full object-cover" />
          </div>
          <div className="flex flex-col gap-2 flex-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
            track("photo_picker_opened");
            inputRef.current?.click();
          }}
            >
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              {t("photo.swap")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRemove}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              {t("common.remove")}
            </Button>
          </div>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        data-slot-id={slotId}
        onChange={(e) => onFiles(e.target.files)}
      />
    </div>
  );
}
