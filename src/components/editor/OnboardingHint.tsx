import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Lightbulb, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOnboarding } from "@/hooks/useOnboarding";
import type { SectionId } from "./ControlPanel";

interface Props {
  sectionId: SectionId;
}

/**
 * Inline-hint som visas överst i en flik så länge denna flik är "nästa
 * oklara steg" enligt mallens flikordning. Försvinner när:
 *  - kunden klickar X (dismissad denna session), eller
 *  - state-villkoret är uppfyllt (för bild/forvandling/karta), eller
 *  - dwell-timer löper ut för "passiva" flikar (stil/text/format/lager).
 */
export function OnboardingHint({ sectionId }: Props) {
  const { t } = useTranslation();
  const { activeHintSection, hintTextKey, markCompleted, dismiss } = useOnboarding();
  const isActive = activeHintSection === sectionId;

  // För flikar utan state-baserad completion (stil/text/format/lager):
  // markera som klar så fort fliken öppnas — badgen ska hoppa vidare direkt.
  // Aktiva flikar (bild/forvandling/karta) markeras endast när kund-state
  // är uppfyllt (hanteras i useOnboarding).
  useEffect(() => {
    if (!isActive) return;
    const passive: SectionId[] = ["stil", "text", "format", "lager", "loppinfo"];
    if (!passive.includes(sectionId)) return;
    markCompleted(sectionId);
  }, [isActive, sectionId, markCompleted]);

  if (!isActive) return null;

  const key = hintTextKey(sectionId);
  if (!key) return null;

  return (
    <div
      className={cn(
        "relative flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 pr-8",
        "animate-fade-in",
      )}
      role="status"
    >
      <Lightbulb className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
      <p className="text-[12px] leading-snug text-foreground/90">{t(key)}</p>
      <button
        type="button"
        onClick={() => dismiss(sectionId)}
        aria-label={t("common.close", { defaultValue: "Stäng" })}
        className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
