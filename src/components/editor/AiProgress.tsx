// In-place loading bar for image-generation flows. Shows a spinner, a label,
// a percentage, and a sub-stage line. Progress is time-based: it ramps toward
// 90% over `expectedSeconds`, then waits there until `active` flips to false,
// at which point it snaps to 100% and fades out.
//
// We do NOT have real progress from the upstream image service (request is
// synchronous from our edge function's perspective), so this is an honest
// best-effort indicator. It never hits 100% before the work is actually done.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface AiProgressProps {
  active: boolean;
  /** Roughly how long the operation takes on average. Drives ramp speed. */
  expectedSeconds: number;
  /** Top label, e.g. "Skapar bild". */
  label?: string;
  /** Optional sub-stage line that the parent updates as steps progress. */
  stage?: string | null;
  className?: string;
}

export function AiProgress({
  active,
  expectedSeconds,
  label,
  stage,
  className,
}: AiProgressProps) {
  const { t } = useTranslation();
  const [pct, setPct] = useState(0);
  const [visible, setVisible] = useState(false);
  const [slowHint, setSlowHint] = useState(false);
  const startedAt = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);
  const fadeTimer = useRef<number | null>(null);

  useEffect(() => {
    if (active) {
      // Reset and start ramping.
      if (fadeTimer.current) {
        window.clearTimeout(fadeTimer.current);
        fadeTimer.current = null;
      }
      setVisible(true);
      setPct(0);
      setSlowHint(false);
      startedAt.current = performance.now();

      const tick = () => {
        if (startedAt.current == null) return;
        const elapsed = (performance.now() - startedAt.current) / 1000;
        const ramped = Math.min(90, (elapsed / Math.max(1, expectedSeconds)) * 90);
        setPct(ramped);
        if (elapsed > expectedSeconds * 1.5) setSlowHint(true);
        rafId.current = requestAnimationFrame(tick);
      };
      rafId.current = requestAnimationFrame(tick);

      return () => {
        if (rafId.current) cancelAnimationFrame(rafId.current);
        rafId.current = null;
      };
    }

    // Not active: snap to 100% if we were running, then fade out.
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    if (startedAt.current != null) {
      setPct(100);
      startedAt.current = null;
      fadeTimer.current = window.setTimeout(() => {
        setVisible(false);
        setPct(0);
        setSlowHint(false);
      }, 500);
    }
    return () => {
      if (fadeTimer.current) {
        window.clearTimeout(fadeTimer.current);
        fadeTimer.current = null;
      }
    };
  }, [active, expectedSeconds]);

  if (!visible) return null;

  const displayPct = Math.round(pct);
  const subText = slowHint && active
    ? t("ai.stageSlow")
    : stage ?? t("ai.stagePrepShort");

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-muted/40 px-3 py-2.5 space-y-2 transition-opacity",
        !active && "opacity-70",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>{label ?? t("ai.creatingImage")}</span>
        </div>
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
          {displayPct}%
        </span>
      </div>
      <Progress value={displayPct} className="h-1.5" />
      <div className="text-[11px] text-muted-foreground leading-tight">
        {subText}
      </div>
    </div>
  );
}
