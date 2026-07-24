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
  output_image_url: string | null;
  style_id: string | null;
  style_label: string | null;
  created_at: string;
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

interface PreviousResultsProps {
  /** Referens-URL:er som resultat måste höra till (lagrets alla referenser). */
  referenceUrls: string[];
  /** Nuvarande valt resultat — markeras med ring. */
  activeUrl?: string | null;
  onPick: (url: string) => void;
  className?: string;
}

export function PreviousResults({
  referenceUrls,
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

  const relevant = rows.filter(
    (r) =>
      !!r.output_image_url &&
      !!r.reference_image_url &&
      referenceUrls.includes(r.reference_image_url),
  );
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
