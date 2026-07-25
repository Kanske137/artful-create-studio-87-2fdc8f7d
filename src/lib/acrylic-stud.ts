// Spunnen metall-distans ("standoff") som matchar Gelatos akrylprint-rendering:
// konisk borstad cap med ljuset uppifrån, svagt mörknad kontip i centrum och en
// mörk bezelring vid ytterkanten. Uppmätt ur Gelatos produktrender: cap ~18 mm
// diameter, centrum ~26 mm från panelkanterna. Delas av mockup-composite,
// template-snapshot och AcrylicCornerOverlay så alla ytor ser identiska ut.

export const STUD_DIAMETER_CM = 1.8;
/** Avstånd panelkant → distansens CENTRUM (cm). */
export const STUD_INSET_CM = 2.6;

/** Konisk gradient (0 = kl 12, medurs) — symmetrisk kring vertikalaxeln. */
const CONIC_STOPS: Array<[number, string]> = [
  [0, "#eef1f3"],
  [0.14, "#c9cdd1"],
  [0.3, "#83898f"],
  [0.42, "#a8adb2"],
  [0.5, "#8e9499"],
  [0.58, "#a8adb2"],
  [0.7, "#83898f"],
  [0.86, "#c9cdd1"],
  [1, "#eef1f3"],
];

/** CSS-bakgrund för DOM-varianten (AcrylicCornerOverlay). */
export function studBackgroundCss(): string {
  const conic = CONIC_STOPS.map(([p, c]) => `${c} ${p * 100}%`).join(", ");
  return (
    "radial-gradient(circle at 50% 50%, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.06) 20%, rgba(0,0,0,0) 45%), " +
    `conic-gradient(from 0deg, ${conic})`
  );
}

/** Canvas-varianten — ritar hela distansen (skugga, cap, kontip, bezel). */
export function drawAcrylicStud(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.30)";
  ctx.shadowBlur = r * 0.8;
  ctx.shadowOffsetY = r * 0.28;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const anyCtx = ctx as CanvasRenderingContext2D & {
    createConicGradient?: (angle: number, x: number, y: number) => CanvasGradient;
  };
  let fill: CanvasGradient;
  if (typeof anyCtx.createConicGradient === "function") {
    const cg = anyCtx.createConicGradient(-Math.PI / 2, cx, cy);
    for (const [p, c] of CONIC_STOPS) cg.addColorStop(p, c);
    fill = cg;
  } else {
    // Äldre browsers: radial approximation
    const rg = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.15, cx, cy, r);
    rg.addColorStop(0, "#f2f4f6");
    rg.addColorStop(0.55, "#b9bfc6");
    rg.addColorStop(1, "#6c737b");
    fill = rg;
  }
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();

  // Kontip — spunnen kon konvergerar mot en svagt mörkare mittpunkt
  const tip = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.45);
  tip.addColorStop(0, "rgba(0,0,0,0.20)");
  tip.addColorStop(1, "rgba(0,0,0,0)");
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = tip;
  ctx.fill();

  // Mörk bezelring vid ytterkanten + tunn ljus reflexkant utanför
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.94, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(28,31,34,0.85)";
  ctx.lineWidth = Math.max(0.8, r * 0.13);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = Math.max(0.5, r * 0.05);
  ctx.stroke();
}
