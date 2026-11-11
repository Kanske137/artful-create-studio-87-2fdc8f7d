// Sidebar list of all layers in the active orientation.
//   - Click to select
//   - Up/down to reorder zIndex
//   - Eye to toggle visibility lock
//   - Lock icon to lock/unlock everything
//   - Trash to delete
import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, Trash2, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TemplateLayer } from "@/lib/template-schema";
import { defaultLocks } from "@/lib/template-schema";

interface Props {
  layers: TemplateLayer[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onToggleVisibility: (id: string) => void;
  onToggleLockAll: (id: string) => void;
  onDelete: (id: string) => void;
}

const typeLabel: Record<TemplateLayer["type"], string> = {
  map: "Karta",
  text: "Text",
  image: "Bild",
  photo: "Foto",
  aiPhoto: "AI-bild",
  line: "Linje",
  margin: "Marginal",
  shape: "Figur",
  starmap: "Stjärnkarta",
  elevation: "Höjdprofil",
  raceStats: "Loppstatistik",
};

export default function LayerList({
  layers,
  selectedId,
  onSelect,
  onMove,
  onToggleVisibility,
  onToggleLockAll,
  onDelete,
}: Props) {
  // Display top → bottom = highest zIndex first (matches visual stacking).
  const sorted = [...layers].sort((a, b) => b.zIndex - a.zIndex);

  if (sorted.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        Inga lager än. Lägg till en karta eller text via verktygsknapparna.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {sorted.map((layer, idx) => {
        const isSelected = selectedId === layer.id;
        const fullyLocked = Object.values(layer.locks).every((v) => v === true);
        const isHidden = layer.locks.visibility === true && idx === -1; // visibility lock != hidden; we use a separate hidden flag below
        return (
          <li key={layer.id}>
            <div
              className={cn(
                "flex items-center gap-1 rounded-md border px-2 py-1.5 text-sm cursor-pointer",
                isSelected ? "border-primary bg-accent" : "border-transparent hover:bg-accent/50",
              )}
              onClick={() => onSelect(layer.id)}
            >
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground w-12 shrink-0">
                {typeLabel[layer.type]}
              </span>
              <span className="flex-1 truncate">{layer.name}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Flytta upp"
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(layer.id, "up");
                }}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Flytta ner"
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(layer.id, "down");
                }}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title={layer.locks.visibility ? "Lås upp synlighet" : "Lås synlighet"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility(layer.id);
                }}
              >
                {layer.locks.visibility ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title={fullyLocked ? "Lås upp allt" : "Lås allt"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLockAll(layer.id);
                }}
              >
                {fullyLocked ? (
                  <Lock className="h-3.5 w-3.5" />
                ) : (
                  <Unlock className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                title="Ta bort"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(layer.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Helper used by DesignerPage when toggling "lock all"
export function toggleAllLocks(layer: TemplateLayer): TemplateLayer {
  const allLocked = Object.values(layer.locks).every((v) => v === true);
  const next = allLocked
    ? defaultLocks({
        position: false,
        move: false,
        size: false,
        shape: false,
        content: false,
        font: false,
        visibility: false,
        style: false,
      })
    : defaultLocks({
        position: true,
        move: true,
        size: true,
        shape: true,
        content: true,
        font: true,
        visibility: true,
        style: true,
      });
  return { ...layer, locks: next };
}
