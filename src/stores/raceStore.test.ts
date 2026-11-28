import { beforeEach, describe, expect, it } from "vitest";
import { useRaceStore } from "./raceStore";
import { defaultRaceFor, raceFromParam } from "@/lib/race/catalog";
import type { RaceRoute } from "@/lib/race/types";

const route = { coords: [[18.0, 59.3], [18.1, 59.31]], distanceKm: 42.2 } as unknown as RaceRoute;

describe("förvalt lopp", () => {
  beforeEach(() => useRaceStore.getState().reset());

  it("exempellopp per produkt", () => {
    expect(defaultRaceFor("maratontavla")?.id).toBe("stockholm-marathon");
    expect(defaultRaceFor("halvmaratontavla")?.id).toBe("goteborgsvarvet");
    expect(defaultRaceFor("lopartavla")?.id).toBe("midnattsloppet-stockholm");
    expect(defaultRaceFor("vasaloppstavla")).toBeNull();
  });

  it("djuplänk godtar bara lopp med bana", () => {
    expect(raceFromParam("goteborgsvarvet")?.id).toBe("goteborgsvarvet");
    expect(raceFromParam("Goteborgsvarvet ")?.id).toBe("goteborgsvarvet");
    expect(raceFromParam("tjejmilen")).toBeNull(); // saknar ritad bana
    expect(raceFromParam("<script>")).toBeNull();
    expect(raceFromParam(null)).toBeNull();
  });

  it("förval spärrar tills kunden ändrar något", () => {
    const race = defaultRaceFor("maratontavla")!;
    useRaceStore.getState().setFromCatalog(race, route, null, { auto: true });
    expect(useRaceStore.getState().autoSelected).toBe(true);
    expect(useRaceStore.getState().fields.title).toBe("Stockholm Marathon");
    useRaceStore.getState().setField("runnerName", "Anna");
    expect(useRaceStore.getState().autoSelected).toBe(false);
  });

  it("kundens eget loppval släpper spärren", () => {
    const race = defaultRaceFor("maratontavla")!;
    useRaceStore.getState().setFromCatalog(race, route, null, { auto: true });
    useRaceStore.getState().setFromCatalog(race, route, null);
    expect(useRaceStore.getState().autoSelected).toBe(false);
  });
});
