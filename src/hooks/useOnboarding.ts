import { useEffect, useMemo } from "react";
import { useEditorStore } from "@/stores/editorStore";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { useRaceStore } from "@/stores/raceStore";
import { useAvailableSections, type SectionId } from "@/components/editor/ControlPanel";

/**
 * Returnerar vilken flik som just nu ska visa "nästa steg"-hint, plus en
 * lämplig i18n-nyckel per flik (anpassad efter mallens lagertyper, t.ex.
 * face swap / multi-face / AI-foto).
 *
 * Hooken auto-markerar `bild`, `forvandling` och `karta` som klara när
 * relevant kund-state finns. Andra flikar (`stil`, `text`, `format`,
 * `lager`) markeras via dwell-timer i OnboardingHint-komponenten.
 */
export function useOnboarding() {
  const sections = useAvailableSections();
  const completed = useOnboardingStore((s) => s.completed);
  const dismissed = useOnboardingStore((s) => s.dismissed);
  const markCompleted = useOnboardingStore((s) => s.markCompleted);
  const dismiss = useOnboardingStore((s) => s.dismiss);

  const templateLayers = useEditorStore((s) => s.templateLayers);
  const photoSources = useEditorStore((s) => s.photoSources);
  const aiPhotoSources = useEditorStore((s) => s.aiPhotoSources);
  const aiPhotoResults = useEditorStore((s) => s.aiPhotoResults);
  const multiFacePortraits = useEditorStore((s) => s.multiFacePortraits);
  const layerValues = useEditorStore((s) => s.layerValues);

  const layers = templateLayers();
  const raceRoute = useRaceStore((s) => s.route);

  // Auto-mark LOPP när ett lopp valts eller en GPX-fil laddats upp.
  useEffect(() => {
    if (completed.lopp) return;
    if (raceRoute) markCompleted("lopp");
  }, [raceRoute, completed.lopp, markCompleted]);

  // Auto-mark BILD när minst ett photo-lager har upload.
  useEffect(() => {
    if (completed.bild) return;
    if (Object.keys(photoSources).length > 0) markCompleted("bild");
  }, [photoSources, completed.bild, markCompleted]);

  // Auto-mark FORVANDLING när minst ett aiPhoto-lager har källbild
  // (single-face) eller minst en portrait-slot är ifylld (multi-face).
  useEffect(() => {
    if (completed.forvandling) return;
    if (Object.keys(aiPhotoSources).length > 0 || Object.keys(aiPhotoResults).length > 0) {
      markCompleted("forvandling");
      return;
    }
    for (const slots of Object.values(multiFacePortraits)) {
      if (slots && Object.keys(slots).length > 0) {
        markCompleted("forvandling");
        return;
      }
    }
  }, [aiPhotoSources, aiPhotoResults, multiFacePortraits, completed.forvandling, markCompleted]);

  // Auto-mark KARTA när någon map har ändrat plats från template default.
  useEffect(() => {
    if (completed.karta) return;
    const mapLayers = layers.filter((l) => l.type === "map");
    for (const l of mapLayers) {
      const v = layerValues[l.id] as { kind: "map"; center: [number, number]; placeName: string } | undefined;
      if (!v) continue;
      const d = (l as any).defaults;
      const movedCenter =
        Math.abs(v.center[0] - d.center[0]) > 1e-6 || Math.abs(v.center[1] - d.center[1]) > 1e-6;
      const changedName = (v.placeName ?? "") !== (d.placeName ?? "");
      if (movedCenter || changedName) {
        markCompleted("karta");
        return;
      }
    }
  }, [layerValues, layers, completed.karta, markCompleted]);

  const activeHintSection: SectionId | null = useMemo(() => {
    for (const s of sections) {
      if (completed[s.id]) continue;
      if (dismissed[s.id]) continue;
      return s.id;
    }
    return null;
  }, [sections, completed, dismissed]);

  const hasAnyCompleted = useMemo(
    () => Object.values(completed).some(Boolean),
    [completed],
  );

  const hintTextKey = (section: SectionId): string => {
    if (section === "forvandling") {
      const aiPhoto = layers.find((l) => l.type === "aiPhoto") as any;
      if (aiPhoto?.defaults?.multiFaceSwap?.enabled) return "onboarding.forvandling.multiFace";
      if (aiPhoto?.defaults?.faceSwap?.enabled) return "onboarding.forvandling.faceSingle";
      return "onboarding.forvandling.aiPhoto";
    }
    if (section === "bild") return "onboarding.bild";
    if (section === "karta") return "onboarding.karta";
    if (section === "stil") return "onboarding.stil";
    if (section === "text") return "onboarding.text";
    if (section === "format") return "onboarding.format";
    if (section === "lager") return "onboarding.lager";
    if (section === "lopp") return "onboarding.lopp";
    if (section === "loppinfo") return "onboarding.loppinfo";
    return "";
  };

  return { activeHintSection, hintTextKey, markCompleted, dismiss, hasAnyCompleted };
}
