// Liten signal-store som låter resultat-/köp-zonen (EditorPage CTA-block) styra
// åtgärder som "bor" i kontrollpanelen, utan proppborrning:
//  • openSection(id) → EditorShell öppnar sektionen (t.ex. "forvandling" för
//    "Byt stil") och fäller ut mobil-lådan.
//  • regenerate() → AiPhotoSection kör om aktuell generering (samma foto + stil)
//    för en ny variant ("Prova igen").
import { create } from "zustand";
import type { SectionId } from "@/components/editor/ControlPanel";

interface ResultActionsStore {
  /** Sektion som ska öppnas (konsumeras av EditorShell), null när inget väntar. */
  pendingSection: SectionId | null;
  /** Ökas vid varje "Prova igen" — AiPhotoSection kör om vid ändring. */
  regenerateNonce: number;
  openSection: (id: SectionId) => void;
  regenerate: () => void;
  consumePendingSection: () => void;
}

export const useResultActionsStore = create<ResultActionsStore>((set) => ({
  pendingSection: null,
  regenerateNonce: 0,
  openSection: (id) => set({ pendingSection: id }),
  regenerate: () => set((s) => ({ regenerateNonce: s.regenerateNonce + 1 })),
  consumePendingSection: () => set({ pendingSection: null }),
}));
