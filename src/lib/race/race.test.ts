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
    expect(productHandleForCategory("trail")).toBe("lopptavla");
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
    expect(raceFieldText("subtitle", base)).toBe("Stockholm · 2026");
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
