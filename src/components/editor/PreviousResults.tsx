// "Tidigare bilder" (Paket F steg 1): enhetens tidigare lyckade genereringar
// för samma referensbilder — klick återanvänder resultatet direkt (gratis,
// ingen omgenerering; bilden ligger redan sparad på servern). Matchning sker
// på referens-URL så resultatet garanterat passar lagrets geometri.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { getSessionKey } from "@/lib/analytics";
import { cn } from "@/lib/utils";

export interface PreviousGeneration {
  design_id: string;
  subject_kind: string | null;
  handle: string | null;
  layer_id: string | null;
  reference_image_url: string | null;
  input_image_url: string | null;
  input_image_urls: string[] | null;
  output_image_url: string | null;
  style_id: string | null;
  style_label: string | null;
  created_at: string;
}

/** Hämta en lagrad bild och gör om den till en File — samma väg som en
 *  vanlig uppladdning tar, så hash/uppladdningsflödet fungerar oförändrat. */
async function fileFromUrl(url: string): Promise<File | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const blob = await r.blob();
    const name = url.split("/").pop()?.split("?")[0] || "foto.jpg";
    return new File([blob], name, { type: blob.type || "image/jpeg" });
  } catch {
    return null;
  }
}

// Modulcache (60 s) — flera sektioner på samma sida delar ett anrop.
let cache: { at: number; rows: PreviousGeneration[] } | null = null;
let inflight: Promise<PreviousGeneration[]> | null = null;

async function fetchMine(): Promise<PreviousGeneration[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.rows;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("my-generations", {
        body: { sessionKey: getSessionKey() },
      });
      if (error) throw error;
      const rows =
        (data as { ok?: boolean; generations?: PreviousGeneration[] })?.generations ?? [];
      cache = { at: Date.now(), rows };
      return rows;
    } catch (e) {
      console.warn("[previous] kunde inte hämta tidigare bilder:", e);
      return cache?.rows ?? [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Anropas efter en ny lyckad generering så remsan plockar upp den direkt. */
export function invalidatePreviousResults(): void {
  cache = null;
}

interface PreviousUploadsProps {
  /** Får en File byggd från det lagrade fotot — mata in i samma flöde som en
   *  vanlig uppladdning. */
  onPick: (file: File) => void;
  className?: string;
}

/** "Dina uppladdade foton" — kundens tidigare uppladdade porträtt (globalt,
 *  oavsett mall). Klick återanvänder fotot som uppladdning i aktuell sektion;
 *  själva genereringen körs som vanligt. */
export function PreviousUploads({ onPick, className }: PreviousUploadsProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PreviousGeneration[]>([]);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void fetchMine().then((r) => {
      if (mounted) setRows(r);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const urls: string[] = [];
  for (const r of rows) {
    const list =
      r.input_image_urls && r.input_image_urls.length > 0
        ? r.input_image_urls
        : r.input_image_url
          ? [r.input_image_url]
          : [];
    for (const u of list) {
      if (u && !urls.includes(u)) urls.push(u);
    }
  }
  const visible = urls.slice(0, 12);
  if (visible.length === 0) return null;

  const pick = async (u: string) => {
    if (busyUrl) return;
    setBusyUrl(u);
    try {
      const f = await fileFromUrl(u);
      if (!f) throw new Error("fetch failed");
      onPick(f);
      toast.success(t("previousUploads.appliedToast"));
    } catch {
      toast.error(t("previousUploads.failedToast"));
    } finally {
      setBusyUrl(null);
    }
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("previousUploads.title")}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {visible.map((u) => (
          <button
            key={u}
            type="button"
            title={t("previousUploads.use")}
            onClick={() => void pick(u)}
            className={cn(
              "h-16 w-16 shrink-0 overflow-hidden rounded-md ring-1 ring-border bg-muted transition hover:-translate-y-0.5",
              busyUrl === u && "opacity-50",
            )}
          >
            <img
              src={u}
              alt={t("previousUploads.use")}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

interface PreviousResultsProps {
  /** Referens-URL:er som resultat måste höra till (lagrets alla referenser).
   *  Utelämnas när subjectKinds används i stället. */
  referenceUrls?: string[];
  /** Alternativ matchning: visa resultat av dessa subject_kind (t.ex. "style"
   *  som saknar referensbilder). */
  subjectKinds?: string[];
  /** Nuvarande valt resultat — markeras med ring. */
  activeUrl?: string | null;
  onPick: (url: string) => void;
  className?: string;
}

export function PreviousResults({
  referenceUrls,
  subjectKinds,
  activeUrl,
  onPick,
  className,
}: PreviousResultsProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PreviousGeneration[]>([]);

  useEffect(() => {
    let mounted = true;
    void fetchMine().then((r) => {
      if (mounted) setRows(r);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const relevant = rows.filter((r) => {
    if (!r.output_image_url) return false;
    if (subjectKinds && subjectKinds.length > 0) {
      return subjectKinds.includes(r.subject_kind ?? "");
    }
    return !!r.reference_image_url && !!referenceUrls?.includes(r.reference_image_url);
  });
  if (relevant.length === 0) return null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("previous.title")}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {relevant.map((r) => (
          <button
            key={r.design_id}
            type="button"
            title={t("previous.use")}
            onClick={() => {
              onPick(r.output_image_url!);
              toast.success(t("previous.appliedToast"));
            }}
            className={cn(
              "h-16 w-16 shrink-0 overflow-hidden rounded-md ring-1 ring-border bg-muted transition hover:-translate-y-0.5",
              activeUrl === r.output_image_url && "ring-2 ring-primary",
            )}
          >
            <img
              src={r.output_image_url!}
              alt={t("previous.use")}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
