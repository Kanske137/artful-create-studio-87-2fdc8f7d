// Hur en kartlager ritas i kundvagnsbild, mockup och tryckfil så att exakt
// samma område syns som i editorn.
//
// Mapbox visar olika mycket beroende på kartrutans bredd: samma center/zoom i
// en 4800 px bred ruta visar ~6 gånger större område än i editorns ~800 px.
// Tidigare ritades tryckfilen så — kunden fick en helt annan karta än den hon
// valde. Nu:
//   1. Kartan ritas i en ruta med "referensbredd" i CSS-px (samma täthet som
//      kundvagnsbilden: 24 px/cm, max 1800 px långsida) och skalas upp med
//      devicePixelRatio. Linjer och etiketter får då samma proportioner i
//      tryck som i kundvagnsbilden, bara skarpare.
//   2. Zoomen räknas om från editorns rutbredd (viewWidthPx) till
//      referensbredden, så att området blir exakt detsamma som i editorn.
//      Saknas viewWidthPx (äldre designer) blir området detsamma som i
//      kundvagnsbilden, som kunden och analytics har sett.

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Kundvagnsbildens täthet: 24 px/cm, högst 1800 px på långsidan. */
export function mapReferencePxPerCm(wCm: number, hCm: number): number {
  const longest = Math.max(wCm, hCm) * 24;
  return 24 * Math.min(1, longest > 0 ? 1800 / longest : 1);
}

export interface MapPrintView {
  /** Kartrutans storlek i CSS-px (hela ytan, inklusive utfallszon). */
  cssW: number;
  cssH: number;
  /** devicePixelRatio under ritningen: utdata-px per CSS-px. */
  pixelRatio: number;
  /** Zoom att rita med i rutan ovan. */
  zoom: number;
  /** Var lagrets egen mittpunkt ligger relativt rutans mitt, i CSS-px.
   *  Skiljer sig från noll när bara en sida förlängts med utfall. */
  frontCenterOffsetCss: { x: number; y: number };
}

export function mapPrintView(args: {
  /** Ytan som ritas, i utdata-px (inklusive ev. utfall/omvik). */
  rect: PxRect;
  /** Lagrets egen yta, i utdata-px — motsvarar editorns kartruta. */
  front: PxRect;
  /** Kundens zoom i editorn. */
  zoom: number;
  /** Editorns kartrutebredd i CSS-px när zoomen sattes. */
  viewWidthPx?: number | null;
  /** Utdata-px per CSS-px (tryck: hires-täthet / referenstäthet). */
  pixelRatio: number;
}): MapPrintView {
  const k = args.pixelRatio > 0 ? args.pixelRatio : 1;
  const frontCssW = args.front.w / k;
  const zoom =
    args.viewWidthPx && args.viewWidthPx > 0 && frontCssW > 0
      ? args.zoom + Math.log2(frontCssW / args.viewWidthPx)
      : args.zoom;
  const rectCx = args.rect.x + args.rect.w / 2;
  const rectCy = args.rect.y + args.rect.h / 2;
  const frontCx = args.front.x + args.front.w / 2;
  const frontCy = args.front.y + args.front.h / 2;
  return {
    cssW: args.rect.w / k,
    cssH: args.rect.h / k,
    pixelRatio: k,
    zoom,
    frontCenterOffsetCss: { x: (frontCx - rectCx) / k, y: (frontCy - rectCy) / k },
  };
}

/**
 * Kör `fn` med window.devicePixelRatio satt till `ratio` (Mapbox läser den
 * för canvasens upplösning). Körningar köas så att två samtidiga renderingar
 * (t.ex. mockups och kundvagn) aldrig skriver över varandras värde.
 */
let dprQueue: Promise<unknown> = Promise.resolve();
export function withDevicePixelRatio<T>(ratio: number, fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const desc = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => ratio });
    try {
      return await fn();
    } finally {
      if (desc) Object.defineProperty(window, "devicePixelRatio", desc);
      else delete (window as unknown as { devicePixelRatio?: number }).devicePixelRatio;
    }
  };
  const next = dprQueue.then(run, run);
  dprQueue = next.catch(() => undefined);
  return next;
}
