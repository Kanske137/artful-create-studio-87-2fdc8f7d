// Exempeldata för adminens förhandsvisning av lopptavlans lager, så att
// mallen kan designas med realistiskt innehåll innan något lopp är valt.
import type { RaceStatItem } from "./derive";

/** Mjuk, kuperad profil (ungefär som ett stadsmaraton). */
export const SAMPLE_ELEVATION: number[] = Array.from({ length: 160 }, (_, i) => {
  const t = i / 159;
  return 18 + 14 * Math.sin(t * Math.PI * 3.2) + 9 * Math.sin(t * Math.PI * 7.5 + 1) + 22 * Math.exp(-((t - 0.62) ** 2) / 0.004);
});

export const SAMPLE_STATS: RaceStatItem[] = [
  { key: "distance", label: "DISTANS", value: "42,195 km" },
  { key: "time", label: "TID", value: "3:45:12" },
  { key: "pace", label: "TEMPO", value: "5:20 /km" },
  { key: "bib", label: "STARTNR", value: "12345" },
  { key: "placement", label: "PLACERING", value: "4 812" },
];
