// Liten signal-store: låter resultat-/köp-zonen (EditorPage CTA-block) öppna en
// sektion i kontrollpanelen utan proppborrning. "Byt bild"/"Byt stil" ber
// EditorShell öppna forvandling-sektionen (+ fälla ut mobil-lådan) så kunden
// når uppladdning/stilval direkt från resultatet.
import { create } from "zustand";
import type { SectionId } from "@/components/editor/ControlPanel";

interface ResultActionsStore {
  /** Sektion som ska öppnas (konsumeras av EditorShell), null när inget väntar. */
  pendingSection: SectionId | null;
  openSection: (id: SectionId) => void;
  consumePendingSection: () => void;
}

export const useResultActionsStore = create<ResultActionsStore>((set) => ({
  pendingSection: null,
  openSection: (id) => set({ pendingSection: id }),
  consumePendingSection: () => set({ pendingSection: null }),
}));
