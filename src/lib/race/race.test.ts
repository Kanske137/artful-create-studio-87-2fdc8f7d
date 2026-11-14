import { describe, expect, it } from "vitest";
import {
  boundsOf,
  cumulativeKm,
  elevationGainM,
  elevationSeries,
  fillGaps,
  haversineKm,
  kmMarkers,
  simplifyToMax,
} from "./geo";
import { GpxError, parseGpx, routeFromGpx } from "./gpx";
import { formatDistance, formatDuration, formatPace, formatRaceDate, parseDuration } from "./format";
import { categoryForDistance, productHandleForCategory, routeFromGeoJson } from "./catalog";
import { raceFieldText, raceStatItems } from "./derive";
import { DEFAULT_RACE_SHOW, EMPTY_RACE_FIELDS, type LngLat, type RaceRenderInput } from "./types";

// Rak linje norrut från Stockholm: 0,001° lat ≈ 111 m.
function line(n: number, step = 0.001): LngLat[] {
  return Array.from({ length: n }, (_, i) => [18.0686, 59.3293 + i * step] as LngLat);
}

function gpx(points: LngLat[], opts: { ele?: boolean; time?: boolean; name?: string } = {}): string {
  const t0 = Date.parse("2026-05-30T12:00:00Z");
  const pts = points
    .map(([lon, lat], i) => {
      const ele = opts.ele ? `<ele>${10 + (i % 7)}</ele>` : "";
      const time = opts.time ? `<time>${new Date(t0 + i * 10_000).toISOString()}</time>` : "";
      return `<trkpt lat="${lat}" lon="${lon}">${ele}${time}</trkpt>`;
    })
    .join("");
  const name = opts.name ? `<name>${opts.name}</name>` : "";
  return `<?xml version="1.0"?><gpx version="1.1" creator="Strava" xmlns="http://www.topografix.com/GPX/1/1"><trk>${name}<trkseg>${pts}</trkseg></trk></gpx>`;
}

describe("geo", () => {
  it("haversine ger rimlig distans", () => {
    expect(haversineKm([18.0686, 59.3293], [18.0686, 59.3393])).toBeCloseTo(1.112, 2);
  });

  it("förenkling behåller ändpunkterna och kortar en rak linje", () => {
    const pts = line(500);
    const idx = simplifyToMax(pts, 50);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(499);
    expect(idx.length).toBeLessThanOrEqual(50);
  });

  it("km-markeringar hamnar på rätt avstånd", () => {
    const pts = line(101); // ~11,1 km
    const total = cumulativeKm(pts)[100]!;
    const marks = kmMarkers(pts, total, 1);
    // 11 km ligger bara ~120 m före mål → utelämnas (krockar med målmarkeringen).
    expect(marks.map((m) => m.km)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(haversineKm(pts[0]!, marks[0]!.at)).toBeCloseTo(1, 2);
  });

  it("höjdserie och stigning", () => {
    const pts = line(50);
    const ele = pts.map((_, i) => (i < 25 ? i * 2 : 48));
    const series = elevationSeries(pts, ele, 40);
    expect(series).toHaveLength(40);
    expect(elevationGainM(series)).toBeGreaterThan(30);
  });

  it("fyller luckor i höjddata, ger null vid för lite data", () => {
    expect(fillGaps([null, 10, null, 20, 30])).toEqual([10, 10, 15, 20, 30]);
    expect(fillGaps([null, null, null, 5])).toBeNull();
  });

  it("boundsOf", () => {
    expect(boundsOf([[1, 2], [3, -1], [0, 5]])).toEqual([[0, -1], [3, 5]]);
  });
});

describe("gpx", () => {
  it("läser spår med höjd, tid och namn", () => {
    const parsed = parseGpx(gpx(line(200), { ele: true, time: true, name: "Morgonlöpning" }));
    expect(parsed.coords).toHaveLength(200);
    expect(parsed.name).toBe("Morgonlöpning");
    const r = routeFromGpx(parsed, 100);
    expect(r.route.coords.length).toBeLessThanOrEqual(100);
    expect(r.route.ele).not.toBeNull();
    expect(r.route.ele!.length).toBe(r.route.coords.length);
    expect(r.route.distanceKm).toBeCloseTo(22.13, 1);
    expect(r.dateISO).toBe("2026-05-30");
    expect(r.elapsedSec).toBe(199 * 10);
  });

  it("fungerar utan höjd och tid", () => {
    const r = routeFromGpx(parseGpx(gpx(line(30))));
    expect(r.route.ele).toBeNull();
    expect(r.dateISO).toBeNull();
    expect(r.elapsedSec).toBeNull();
  });

  it("ger tydliga fel", () => {
    expect(() => parseGpx("inte xml <<<")).toThrow(GpxError);
    expect(() => parseGpx("<kml></kml>")).toThrowError(/inte vara en GPX/);
    expect(() => parseGpx(gpx([]))).toThrowError(/ingen rutt/);
    expect(() => parseGpx(gpx(line(5)))).toThrowError(/för kort/);
  });
});

describe("format", () => {
  it("tolkar tider", () => {
    expect(parseDuration("3:45:12")).toBe(3 * 3600 + 45 * 60 + 12);
    expect(parseDuration("45:12")).toBe(45 * 60 + 12);
    expect(parseDuration("3.45.12")).toBe(13512);
    expect(parseDuration("3:75:00")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });

  it("formaterar tid, tempo, distans och datum", () => {
    expect(formatDuration(13512)).toBe("3:45:12");
    expect(formatDuration(2712)).toBe("45:12");
    expect(formatPace(13512, 42.195)).toBe("5:20 /km");
    expect(formatPace(null, 42.195)).toBeNull();
    expect(formatDistance(42.195)).toBe("42,195 km");
    expect(formatDistance(21.0975)).toBe("21,1 km");
    expect(formatDistance(10)).toBe("10 km");
    expect(formatDistance(30.24)).toBe("30,2 km");
    expect(formatDistance(30.24, "en")).toBe("30.2 km");
    expect(formatRaceDate("2026-05-30")).toBe("30 maj 2026");
    expect(formatRaceDate("2026-05-30", "en")).toBe("30 May 2026");
    expect(formatRaceDate("trasig")).toBe("");
  });
});

describe("katalog och produkter", () => {
  it("kategoriserar distanser", () => {
    expect(categoryForDistance(42.3)).toBe("marathon");
    expect(categoryForDistance(21.2)).toBe("half");
    expect(categoryForDistance(10.1)).toBe("10k");
    expect(categoryForDistance(5)).toBe("5k");
    expect(categoryForDistance(90)).toBe("ultra");
    expect(categoryForDistance(30)).toBe("other");
  });

  it("väljer kundvagnsprodukt utifrån kategori", () => {
    expect(productHandleForCategory("marathon")).toBe("maratontavla");
    expect(productHandleForCategory("half")).toBe("halvmaratontavla");
    expect(productHandleForCategory("trail")).toBe("lopartavla");
  });

  it("läser banfiler med och utan höjd", () => {
    const withEle = routeFromGeoJson(
      { type: "Feature", geometry: { type: "LineString", coordinates: [[18, 59, 10], [18.01, 59.01, 12]] } },
      42.195,
    );
    expect(withEle.ele).toEqual([10, 12]);
    const fc = routeFromGeoJson(
      { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[18, 59], [18.01, 59.01]] } }] },
      10,
    );
    expect(fc.ele).toBeNull();
    expect(() => routeFromGeoJson({}, 10)).toThrow();
  });
});

describe("härledda värden", () => {
  const base: RaceRenderInput = {
    route: { coords: line(3), ele: null, distanceKm: 42.195, bbox: [[0, 0], [1, 1]] },
    fields: { ...EMPTY_RACE_FIELDS, title: "Stockholm Marathon", city: "Stockholm", dateISO: "2026-05-30", finishTime: "3:45:12", bib: "1234" },
    show: { ...DEFAULT_RACE_SHOW },
    routeColor: null,
    locale: "sv",
  };

  it("texter till lagren", () => {
    expect(raceFieldText("title", base)).toBe("Stockholm Marathon");
    expect(raceFieldText("subtitle", base)).toBe("Stockholm · 30 maj 2026");
    expect(raceFieldText("finishTime", base)).toBe("3:45:12");
    expect(raceFieldText("finishTime", { ...base, fields: { ...base.fields, finishTime: "trasig" } })).toBe("");
    expect(raceFieldText("date", base)).toBe("30 maj 2026");
    expect(raceFieldText("runnerName", base)).toBe("");
  });

  it("statistik följer ordning och reglage, hoppar över tomma värden", () => {
    const items = raceStatItems(["distance", "time", "pace", "bib", "placement"], base);
    expect(items.map((i) => i.key)).toEqual(["distance", "time", "pace"]);
    expect(items[2]!.value).toBe("5:20 /km");
    const withBib = raceStatItems(["distance", "bib"], { ...base, show: { ...base.show, bib: true } });
    expect(withBib.map((i) => i.value)).toEqual(["42,195 km", "1234"]);
    const noTime = raceStatItems(["time", "pace"], { ...base, fields: { ...base.fields, finishTime: "" } });
    expect(noTime).toEqual([]);
  });
});

import { overlayAvoidPct, routeFitPaddingPx } from "./route-map";

describe("banan hålls fri från text och foto", () => {
  const map = { id: "m", type: "map", xPct: 0, yPct: 0, wPct: 100, hPct: 100, zIndex: 1 };
  const L = (id: string, yPct: number, hPct: number, zIndex = 5) => ({ id, type: "text", xPct: 8, yPct, wPct: 50, hPct, zIndex });

  it("räknar topp från rubrikblocket och botten från namn/foto", () => {
    const a = overlayAvoidPct([map, L("title", 8, 11), L("stats", 20, 4), L("name", 84, 5), L("photo", 70, 22)], map);
    expect(a.top).toBeCloseTo(24);
    expect(a.bottom).toBeCloseTo(30);
  });

  it("ignorerar lager under kartan", () => {
    expect(overlayAvoidPct([map, L("bg", 0, 100, 0)], map)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it("höga smala lager (kilometertider) räknas till sidan", () => {
    const col = { id: "splits", type: "splits", xPct: 8, yPct: 33, wPct: 24, hPct: 34, zIndex: 17 };
    const a = overlayAvoidPct([map, col, L("title", 8, 11)], map);
    expect(a.left).toBeCloseTo(32);
    expect(a.top).toBeCloseTo(19);
    expect(a.bottom).toBe(0);
  });

  it("lägger luft runt överliggande lager men lämnar plats åt banan", () => {
    const p = routeFitPaddingPx({ color: "#FC4C02", thicknessMm: 1, casing: false, casingColor: "#FFFFFF", fitPaddingPct: { top: 8, right: 9, bottom: 8, left: 9 } }, 1000, 1000, { top: 24, bottom: 30 });
    expect(p.top).toBe(280);
    expect(p.bottom).toBe(340);
    const tight = routeFitPaddingPx(undefined, 1000, 1000, { top: 60, bottom: 50 });
    expect(tight.top + tight.bottom).toBeLessThanOrEqual(800);
  });
});

import { computeSplits } from "./gpx";
import { groupSplits } from "./render-splits";
import { effectiveDistanceKm, raceInactiveLayerIds } from "./derive";

describe("kilometertider", () => {
  // Rak linje: 0,001° lat ≈ 111 m, en punkt var 30:e sekund ⇒ ~4:30/km.
  const pts = line(120);
  const t0 = Date.parse("2026-05-30T10:00:00Z");
  const times = pts.map((_, i) => t0 + i * 30_000);

  it("räknar tid per hel km och tar med sista delen", () => {
    const s = computeSplits(pts, times)!;
    expect(s.length).toBe(14); // 13,2 km ⇒ 13 hela + 0,2
    expect(s[0]!.km).toBe(1);
    expect(s[0]!.seconds).toBeCloseTo(1000 / 111.2 * 30, -1);
    expect(s[s.length - 1]!.distKm).toBeLessThan(1);
    const total = s.reduce((a, x) => a + x.seconds, 0);
    expect(total).toBeCloseTo(119 * 30, 0);
  });

  it("saknar tider ⇒ inga kilometertider", () => {
    expect(computeSplits(pts, pts.map(() => null))).toBeNull();
  });

  it("slår ihop per 5 km för långa lopp", () => {
    const s = Array.from({ length: 42 }, (_, i) => ({ km: i + 1, distKm: 1, seconds: 300 }));
    const g = groupSplits(s, "auto");
    expect(g.length).toBe(9);
    expect(g[0]).toEqual({ km: 5, distKm: 5, seconds: 1500 });
    expect(groupSplits(s.slice(0, 10), "auto").length).toBe(10);
  });

  it("lager utan data räknas som dolda", () => {
    const layers = [{ id: "s", type: "splits" }, { id: "e", type: "elevation" }, { id: "m", type: "map" }];
    expect([...raceInactiveLayerIds(layers, { route: null, splits: null })]).toEqual(["s", "e"]);
    expect([...raceInactiveLayerIds(layers, { route: { ele: [1] }, splits: [{}] })]).toEqual([]);
  });

  it("egen distans går före banans", () => {
    const base = { route: { coords: line(3), ele: null, distanceKm: 42.61, bbox: [[0, 0], [1, 1]] as [[number, number], [number, number]] }, fields: { ...EMPTY_RACE_FIELDS }, show: { ...DEFAULT_RACE_SHOW }, routeColor: null, locale: "sv" as const };
    expect(effectiveDistanceKm(base)).toBe(42.61);
    expect(effectiveDistanceKm({ ...base, fields: { ...base.fields, distanceKm: "42,195" } })).toBe(42.195);
    const items = raceStatItems(["distance", "pace"], { ...base, fields: { ...base.fields, distanceKm: "42,195", finishTime: "3:45:12", pace: "5:15" } });
    expect(items.map((i) => i.value)).toEqual(["42,195 km", "5:15 /km"]);
  });
});

import { Encoder, Profile } from "@garmin/fitsdk";
import { isFitBytes, parseFit } from "./gpx";

describe("TCX och FIT", () => {
  const pts = line(40);
  const t0 = Date.parse("2026-05-30T10:00:00Z");

  it("läser TCX med tider och höjd", () => {
    const tps = pts.map(([lon, lat], i) =>
      `<Trackpoint><Time>${new Date(t0 + i * 20_000).toISOString()}</Time><Position><LatitudeDegrees>${lat}</LatitudeDegrees><LongitudeDegrees>${lon}</LongitudeDegrees></Position><AltitudeMeters>${20 + (i % 5)}</AltitudeMeters></Trackpoint>`,
    ).join("");
    const xml = `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Lap><Track><Trackpoint><Time>${new Date(t0).toISOString()}</Time></Trackpoint>${tps}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
    const r = routeFromGpx(parseGpx(xml));
    expect(r.route.distanceKm).toBeCloseTo(4.33, 1);
    expect(r.elapsedSec).toBe(39 * 20);
    expect(r.splits?.length).toBe(5);
    expect(r.route.ele).not.toBeNull();
  });

  it("läser FIT (Garmins format) med Garmins SDK", async () => {
    const enc = new Encoder();
    // SDK:ns typer för meddelandefält är snäva — testdata skickas som unknown.
    const mesg = (m: Record<string, unknown>) => m as never;
    enc.onMesg(Profile.MesgNum.FILE_ID, mesg({ type: "activity", manufacturer: "garmin", product: 0, timeCreated: new Date(t0), serialNumber: 1234 }));
    pts.forEach(([lon, lat], i) => {
      enc.onMesg(Profile.MesgNum.RECORD, mesg({
        timestamp: new Date(t0 + i * 20_000),
        positionLat: Math.round(lat / (180 / 2 ** 31)),
        positionLong: Math.round(lon / (180 / 2 ** 31)),
        enhancedAltitude: 20 + (i % 5),
      }));
    });
    const bytes = enc.close();
    expect(isFitBytes(bytes)).toBe(true);
    const r = routeFromGpx(await parseFit(bytes));
    expect(r.route.distanceKm).toBeCloseTo(4.33, 1);
    expect(r.dateISO).toBe("2026-05-30");
    expect(r.splits?.length).toBe(5);
  });
});

describe("målflaggan", () => {
  it("är lika hög som startcirkeln är bred (diameter inklusive ring)", async () => {
    const { finishFlagSizePx } = await import("./route-map");
    for (const w of [2, 6, 24]) {
      const { height, width } = finishFlagSizePx(w);
      expect(height).toBeCloseTo(2 * (w * 1.35 + Math.max(1, w * 0.5)), 6);
      expect(width).toBeLessThanOrEqual(height);
    }
  });

  it("ritar stång och rutig duk i ruttfärg och vitt", async () => {
    const { drawFinishFlag } = await import("./route-map");
    const fills: string[] = [];
    const ctx = {
      clearRect() {},
      fillRect() { fills.push(String(this.fillStyle)); },
      strokeRect() {},
      fillStyle: "", strokeStyle: "", lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;
    drawFinishFlag(ctx, 40, 48, "#FC4C02");
    expect(fills.length).toBe(1 + 6);
    expect(new Set(fills)).toEqual(new Set(["#FC4C02", "#FFFFFF"]));
  });

  it("ruttens lager skyddas från etikettreglaget", async () => {
    const { isRouteLayerId } = await import("./route-map");
    expect(isRouteLayerId("arthena-route-finish")).toBe(true);
    expect(isRouteLayerId("label-road")).toBe(false);
  });
});


import { viewBoundsOf } from "./route-map";

describe("viewBoundsOf", () => {
  it("räknar hela kartrutan, oavsett kvarlämnad padding", () => {
    // Enkel linjär karta: x 0..600 → lng 18..19, y 0..800 → lat 60..59.
    const map = {
      getContainer: () => ({ clientWidth: 600, clientHeight: 800 }) as HTMLElement,
      unproject: ([x, y]: [number, number]) => ({ lng: 18 + x / 600, lat: 60 - y / 800 }),
    };
    expect(viewBoundsOf(map as unknown as Parameters<typeof viewBoundsOf>[0])).toEqual([
      [18, 59],
      [19, 60],
    ]);
  });
});

import { usableBounds } from "./route-map";

describe("dold karta och utsnitt", () => {
  it("viewBoundsOf ger null för en dold (0×0) karta", () => {
    const map = {
      getContainer: () => ({ clientWidth: 0, clientHeight: 0 }) as HTMLElement,
      unproject: () => ({ lng: 18, lat: 59 }),
    };
    expect(viewBoundsOf(map as unknown as Parameters<typeof viewBoundsOf>[0])).toBeNull();
  });

  it("usableBounds avvisar ett utsnitt som är en punkt", () => {
    expect(usableBounds([[18.02, 59.34], [18.02, 59.34]])).toBeNull();
    expect(usableBounds(null)).toBeNull();
    expect(usableBounds([[18, 59.2], [18.2, 59.4]])).toEqual([[18, 59.2], [18.2, 59.4]]);
  });
});

import { routeViewLimits } from "./route-map";

describe("routeViewLimits", () => {
  const base = { width: 400, height: 600, zoom: 12, marginPx: 10 };

  it("ingen panorering när rutten ryms, och maxzoom där den precis ryms", () => {
    const r = routeViewLimits({ ...base, box: { x0: 100, y0: 200, x1: 290, y1: 400 } });
    expect(r.pan).toEqual([0, 0]);
    // 190 px bred → ryms 380/190 = 2× → en zoomnivå till
    expect(r.maxZoom).toBeCloseTo(13);
    expect(r.minZoom).toBeCloseTo(10);
  });

  it("drar tillbaka rutten när den panorerats ut åt vänster eller nedåt", () => {
    const r = routeViewLimits({ ...base, box: { x0: -50, y0: 450, x1: 150, y1: 650 } });
    // vänsterkant -50 → ska till 10: panBy(-60) flyttar innehållet 60 px åt höger
    expect(r.pan[0]).toBeCloseTo(-60);
    // underkant 650 → ska till 590: panBy(+60) flyttar innehållet uppåt
    expect(r.pan[1]).toBeCloseTo(60);
  });

  it("centrerar en rutt som är för stor för rutan", () => {
    const r = routeViewLimits({ ...base, box: { x0: -100, y0: 0, x1: 500, y1: 300 } });
    expect(r.pan[0]).toBeCloseTo(0);
    expect(r.maxZoom).toBeLessThan(12);
  });
});
