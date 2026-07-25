// Visar de fyra metalldistanserna som finns IRL i hörnen på Gelatos akrylprint.
// Utseende och mått delas med canvas-renderarna via lib/acrylic-stud:
// spunnen metall-cap (~18 mm) med konisk borstning, mörk bezelring och
// centrum ~26 mm från panelkanterna. Vi renderar i % av posterstorleken så
// proportionerna stämmer i alla format. ENDAST preview/cart — ALDRIG tryckfil.
import { STUD_DIAMETER_CM, STUD_INSET_CM, studBackgroundCss } from "@/lib/acrylic-stud";

interface Props {
  /** Front-storlek (cm) för respektive sida — används för att räkna ut % */
  frontWcm: number;
  frontHcm: number;
  /** Avstånd från kant till diskens CENTRUM (cm). Default enligt Gelato-mått. */
  insetCm?: number;
  /** Diskens diameter (cm). Default enligt Gelato-mått. */
  diameterCm?: number;
  /** Z-index (default 50 — över allt utom guides). */
  zIndex?: number;
}

export function AcrylicCornerOverlay({
  frontWcm,
  frontHcm,
  insetCm = STUD_INSET_CM,
  diameterCm = STUD_DIAMETER_CM,
  zIndex = 50,
}: Props) {
  const dxPct = (insetCm / frontWcm) * 100;
  const dyPct = (insetCm / frontHcm) * 100;
  const dwPct = (diameterCm / frontWcm) * 100;
  const dhPct = (diameterCm / frontHcm) * 100;

  const corners: { top?: string; bottom?: string; left?: string; right?: string }[] = [
    { top: `calc(${dyPct}% - ${dhPct / 2}%)`, left: `calc(${dxPct}% - ${dwPct / 2}%)` },
    { top: `calc(${dyPct}% - ${dhPct / 2}%)`, right: `calc(${dxPct}% - ${dwPct / 2}%)` },
    { bottom: `calc(${dyPct}% - ${dhPct / 2}%)`, left: `calc(${dxPct}% - ${dwPct / 2}%)` },
    { bottom: `calc(${dyPct}% - ${dhPct / 2}%)`, right: `calc(${dxPct}% - ${dwPct / 2}%)` },
  ];

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ zIndex }}
      aria-hidden
    >
      {corners.map((pos, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: `${dwPct}%`,
            height: `${dhPct}%`,
            ...pos,
            background: studBackgroundCss(),
            borderRadius: "50%",
            // Mjuk skugga på akrylen + mörk bezelring vid capens ytterkant
            boxShadow:
              "0 1px 3px rgba(0,0,0,0.35), inset 0 0 0 1.5px rgba(28,31,34,0.8)",
            outline: "0.5px solid rgba(255,255,255,0.3)",
            outlineOffset: "-0.5px",
          }}
        />
      ))}
    </div>
  );
}
