// Flödesgrupper: valfria fält utan tomma hål.
//
// En flödesgrupp är en lodrät stapel av lager inom ett område på framsidan.
// Dolda lager, och lager som saknas i listan (t.ex. för att de filtrerats bort
// inför tryck), hoppas över. Lagren under flyttar upp och `grow`-lager (t.ex.
// kartan) delar på den lediga ytan.
//
// Funktionen är ren och används på ALLA ställen där en tavla ritas —
// förhandsvisning (editorStore.templateLayers), mockuper, kundvagnsbild och
// tryckfil (template-snapshot) — så att editorn och trycket alltid matchar.
import type { FlowGroup, OrientationLayout } from "./template-schema";

interface FlowLayer {
  id: string;
  yPct: number;
  hPct: number;
}

export function applyFlowLayout<L extends FlowLayer>(
  layers: L[],
  flow: FlowGroup[] | undefined,
  isHidden: (id: string) => boolean = () => false,
): L[] {
  if (!flow || flow.length === 0) return layers;
  const byId = new Map(layers.map((l) => [l.id, l] as const));
  const patch = new Map<string, { yPct: number; hPct: number }>();

  for (const group of flow) {
    const visible = group.items.filter(
      (it) => byId.has(it.layerId) && !isHidden(it.layerId) && !patch.has(it.layerId),
    );
    if (visible.length === 0) continue;

    const gap = Math.max(0, group.gapPct ?? 0);
    const totalGap = gap * (visible.length - 1);
    const growers = visible.filter((it) => it.grow);
    const fixedH = visible
      .filter((it) => !it.grow)
      .reduce((sum, it) => sum + byId.get(it.layerId)!.hPct, 0);
    const free = Math.max(0, group.hPct - totalGap - fixedH);
    const growH = growers.length > 0 ? free / growers.length : 0;

    let y = group.yPct;
    if (growers.length === 0) {
      const leftover = Math.max(0, group.hPct - totalGap - fixedH);
      if (group.align === "center") y += leftover / 2;
      else if (group.align === "end") y += leftover;
    }

    for (const it of visible) {
      const h = it.grow ? growH : byId.get(it.layerId)!.hPct;
      patch.set(it.layerId, { yPct: y, hPct: h });
      y += h + gap;
    }
  }

  if (patch.size === 0) return layers;
  return layers.map((l) => {
    const p = patch.get(l.id);
    return p ? { ...l, yPct: p.yPct, hPct: p.hPct } : l;
  });
}

/** Bekvämlighet: applicera ett layoutblocks egna flödesgrupper på dess lager. */
export function applyFlowToLayout(
  layout: OrientationLayout,
  isHidden: (id: string) => boolean = () => false,
): OrientationLayout {
  if (!layout.flow || layout.flow.length === 0) return layout;
  return { ...layout, layers: applyFlowLayout(layout.layers, layout.flow, isHidden) };
}
