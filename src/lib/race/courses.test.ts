// Kontrollerar alla banfiler i public/races: de går att avkoda, längden
// stämmer mot loppets officiella distans och start/mål stämmer med källan.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RACE_CATALOG, decodePolyline, routeFromCompact } from "./catalog";
import { totalKm } from "./geo";

const dir = join(__dirname, "../../../public/races");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

describe("banfiler", () => {
  it("varje banfil hör till ett lopp i katalogen och tvärtom", () => {
    const referenced = RACE_CATALOG.flatMap((r) => r.courses.map((c) => c.file));
    for (const f of files) expect(referenced).toContain(f);
    for (const f of referenced) expect(files).toContain(f);
  });

  for (const f of files) {
    it(f, () => {
      const json = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const race = RACE_CATALOG.find((r) => r.courses.some((c) => c.file === f))!;
      const route = routeFromCompact(json, race.distanceKm);
      const coords = decodePolyline(json.poly);
      // Start/mål som källan, på en avrundningsenhet när (fångar avskrivningsfel i kodningen).
      const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1.01e-5);
      near(coords[0]![0], json.start[0]);
      near(coords[0]![1], json.start[1]);
      near(coords[coords.length - 1]![0], json.end[0]);
      near(coords[coords.length - 1]![1], json.end[1]);
      // Förenklad linje: högst ~3 % kortare än källans mätning.
      const km = totalKm(coords);
      expect(km).toBeGreaterThan(json.measuredKm * 0.97);
      expect(km).toBeLessThanOrEqual(json.measuredKm * 1.001);
      // Källans mätning inom 5 % av officiell distans (terräng/ultra 8 %).
      const tol = race.category === "trail" || race.category === "ultra" ? 0.08 : 0.05;
      expect(Math.abs(json.measuredKm - race.distanceKm) / race.distanceKm).toBeLessThan(tol);
      if (json.ele) expect(route.ele).not.toBeNull();
    });
  }
});
