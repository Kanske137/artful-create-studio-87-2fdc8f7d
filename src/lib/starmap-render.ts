// Deterministisk stjärnhimmelsrenderare — delas av kundeditorn
// (StarmapLayerView) och tryck/mockup-snapshotten (drawStarmapLayer) så att
// förhandsvisning och tryckfil blir identiska per konstruktion.
//
// Astronomi: himlen beräknas för angivet datum/klockslag/plats via lokal
// siderisk tid (GMST + longitud) och ekvatoriella→horisontella koordinater,
// projicerad zenit-centrerat azimutalt (ekvidistant). Öst hamnar till VÄNSTER
// — så ser himlen ut när man tittar UPP, samma konvention som alla
// stjärnkartor. Tidszon approximeras med soltid (longitud/15 h) — gott nog
// för poster; stjärnbilderna är korrekta, himlen kan vara roterad någon grad
// mot exakt zonklocka.
//
// Stjärndata: HYG via d3-celestial (BSD-3, © Olaf Frohn) — bantad till
// [ra, dec, mag] för mag ≤ 5,8 (~4 000 stjärnor = allt blotta ögat ser).

import tzLookup from "tz-lookup";
import starsData from "@/assets/starmap/stars.json";
import linesData from "@/assets/starmap/lines.json";

const STARS = starsData as unknown as Array<[number, number, number]>;
const LINES = linesData as unknown as Array<Array<[number, number]>>;

const DEG = Math.PI / 180;
/** J2000.0-epoken: 2000-01-01T12:00:00Z i epoch-ms. */
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

export interface StarmapMoment {
  /** "YYYY-MM-DD" (lokalt datum på platsen). */
  dateISO: string;
  /** "HH:MM" lokal tid. Tom sträng/undefined ⇒ 22:00. */
  timeHHMM?: string;
  lat: number;
  lon: number;
}

export interface StarmapStyle {
  bgColor: string;
  starColor: string;
  lineColor: string;
  gridColor?: string;
  showConstellations: boolean;
  showGrid: boolean;
  /** Magnitudgräns (default 5.8 = hela katalogen). Lägre tal = färre stjärnor. */
  magLimit?: number;
  /** "circle" (default) = himlen som inskriven cirkel med horisontring.
   *  "rect" = heltäckande: himlen fyller hela rektangeln kant till kant
   *  (projektion skalad så hörnen når horisonten), ingen ring. */
  shape?: "circle" | "rect";
}

/** Zonens UTC-offset (ms) vid en given UTC-tidpunkt, via Intl:s tz-databas. */
function zoneOffsetMs(atUtcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(atUtcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - atUtcMs;
}

/** Epoch-ms för en lokal väggtid i angiven IANA-zon (tvåpass fångar DST). */
function utcFromLocal(y: number, mo: number, d: number, hh: number, mm: number, timeZone: string): number {
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  const utc1 = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(utc1, timeZone);
}

/** Lokal siderisk tid i grader för momentet. Deterministisk (ingen Date.now).
 *  Tidszonen slås upp ur lat/lon (tz-lookup → IANA-zon → Intl:s tz-databas,
 *  inkl. historiska regler och sommartid). Fallback: soltid (longitud/15h). */
export function localSiderealDeg(m: StarmapMoment): number {
  const [y, mo, d] = m.dateISO.split("-").map(Number);
  const [hh, mm] = (m.timeHHMM && /^\d{1,2}:\d{2}$/.test(m.timeHHMM) ? m.timeHHMM : "22:00")
    .split(":")
    .map(Number);
  let utcMs: number;
  try {
    const zone = tzLookup(m.lat, m.lon);
    utcMs = utcFromLocal(y, mo || 1, d || 1, hh ?? 22, mm ?? 0, zone);
  } catch {
    const tzOffsetH = Math.round(m.lon / 15);
    utcMs = Date.UTC(y, (mo || 1) - 1, d || 1, (hh ?? 22) - tzOffsetH, mm ?? 0);
  }
  const days = (utcMs - J2000_MS) / 86400000;
  const gmst = (280.46061837 + 360.98564736629 * days) % 360;
  return (((gmst + m.lon) % 360) + 360) % 360;
}

interface Projected {
  x: number;
  y: number;
  /** Höjd över horisonten i grader (negativ = under horisonten). */
  alt: number;
}

/** RA/Dec (grader) → poster-koordinater i en cirkel med centrum cx,cy radie R. */
function project(
  raDeg: number,
  decDeg: number,
  lstDeg: number,
  latRad: number,
  cx: number,
  cy: number,
  R: number,
): Projected {
  const H = (lstDeg - raDeg) * DEG; // timvinkel, positiv väst
  const dec = decDeg * DEG;
  const sinAlt = Math.sin(latRad) * Math.sin(dec) + Math.cos(latRad) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  // Azimut från norr, östlig positiv (Meeus, A från syd → +180°).
  const azFromSouth = Math.atan2(
    Math.sin(H),
    Math.cos(H) * Math.sin(latRad) - Math.tan(dec) * Math.cos(latRad),
  );
  const az = azFromSouth + Math.PI;
  // Ekvidistant zenitprojektion; öst till vänster (himlen sedd underifrån).
  const r = ((Math.PI / 2 - alt) / (Math.PI / 2)) * R;
  return {
    x: cx - r * Math.sin(az),
    y: cy - r * Math.cos(az),
    alt: alt / DEG,
  };
}

export interface StarmapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Ritar stjärnhimlen i `rect` på en 2D-kontext. Cirkulär himmel inskriven i
 * rektangeln (kortaste sidan styr), bakgrunden fyller hela rect. Alla
 * linjetjocklekar/stjärnstorlekar skalas mot cirkelradien — samma utseende
 * oavsett upplösning, så editor-canvas och hires-tryck blir identiska.
 */
export function renderStarmap(
  ctx: CanvasRenderingContext2D,
  rect: StarmapRect,
  moment: StarmapMoment,
  style: StarmapStyle,
): void {
  const { x, y, w, h } = rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const isRect = style.shape === "rect";
  // Cirkel: himlen inskriven (kortaste sidan). Heltäckande: projektionens
  // horisont läggs vid hörnen (halva diagonalen) så stjärnhimlen fyller
  // varje hörn av rektangeln.
  const R = isRect ? Math.sqrt(w * w + h * h) / 2 : Math.min(w, h) / 2;
  // Radie-relativ skala: 1.0 vid R=300px (typisk editorstorlek).
  const pxScale = R / 300;
  const lst = localSiderealDeg(moment);
  const latRad = moment.lat * DEG;
  const magLimit = style.magLimit ?? 5.8;

  ctx.save();

  // Cirkel: allt klipps till cirkeln. Heltäckande: klipp till rektangeln.
  ctx.beginPath();
  if (isRect) ctx.rect(x, y, w, h);
  else ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = style.bgColor;
  ctx.fillRect(x, y, w, h);

  // --- RA/Dec-graticule (diskret) ---
  if (style.showGrid) {
    ctx.strokeStyle = style.gridColor ?? style.lineColor;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = Math.max(0.5, 0.7 * pxScale);
    // Deklinationscirklar
    for (let dec = -60; dec <= 80; dec += 20) {
      ctx.beginPath();
      let pen = false;
      for (let ra = 0; ra <= 360; ra += 4) {
        const p = project(ra, dec, lst, latRad, cx, cy, R);
        if (p.alt <= 0) {
          pen = false;
          continue;
        }
        if (!pen) {
          ctx.moveTo(p.x, p.y);
          pen = true;
        } else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    // RA-meridianer
    for (let ra = 0; ra < 360; ra += 30) {
      ctx.beginPath();
      let pen = false;
      for (let dec = -80; dec <= 80; dec += 4) {
        const p = project(ra, dec, lst, latRad, cx, cy, R);
        if (p.alt <= 0) {
          pen = false;
          continue;
        }
        if (!pen) {
          ctx.moveTo(p.x, p.y);
          pen = true;
        } else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // --- Stjärnbildslinjer ---
  if (style.showConstellations) {
    ctx.strokeStyle = style.lineColor;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(0.6, 1.1 * pxScale);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const poly of LINES) {
      ctx.beginPath();
      let pen = false;
      for (const [ra, dec] of poly) {
        const p = project(ra, dec, lst, latRad, cx, cy, R);
        if (p.alt <= -2) {
          pen = false;
          continue;
        }
        if (!pen) {
          ctx.moveTo(p.x, p.y);
          pen = true;
        } else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // --- Stjärnor ---
  ctx.fillStyle = style.starColor;
  for (const [ra, dec, mag] of STARS) {
    if (mag > magLimit) continue;
    const p = project(ra, dec, lst, latRad, cx, cy, R);
    if (p.alt <= 0) continue;
    // Storlek efter magnitud: Sirius (−1.4) ≈ 2.6 enheter, mag 5.8 ≈ 0.35.
    const size = Math.max(0.35, Math.pow(6.3 - mag, 1.12) * 0.30) * pxScale;
    // Svaga stjärnor något genomskinliga — ger djup utan gråa färger.
    ctx.globalAlpha = mag > 4.8 ? 0.6 : mag > 3.5 ? 0.82 : 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Tunn horisontring som avslut (bara i cirkelläget).
  if (!isRect) {
    ctx.strokeStyle = style.lineColor;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = Math.max(0.6, 1 * pxScale);
    ctx.beginPath();
    ctx.arc(cx, cy, R - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

/** Formaterar koordinater för texttoken, t.ex. "59.329°N · 18.069°E". */
export function formatStarmapCoords(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(3)}°${ns} · ${Math.abs(lon).toFixed(3)}°${ew}`;
}

/** Formaterar datum för [[date]]-token: "12.06.1994" (lokalneutral). */
export function formatStarmapDate(dateISO: string): string {
  const [y, m, d] = dateISO.split("-");
  if (!y || !m || !d) return dateISO;
  return `${d.padStart(2, "0")}.${m.padStart(2, "0")}.${y}`;
}
