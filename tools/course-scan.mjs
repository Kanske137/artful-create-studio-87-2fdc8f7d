// Hjälpverktyg (körs i webbläsaren på arrangörens sida, inte i appen):
// letar upp länkar till banfiler/kartor på sajten och packar extract-resultat
// för överföring (gzip + base64 + hash). Används av Claude vid inläggning av banor.
import { extract, extractDocument } from "./route-extract.mjs";

const PRI = /bana|banor|karta|kartor|course|route|map|banprofil|sträck/i;
const SUB = /bana|banor|karta|info|lopp|distans|course|route|map|praktisk|deltagare|race|marathon|maraton|halv|21|42/i;
const F = /\.(gpx|kml|kmz)(\?|$)|google\.[a-z.]+\/maps\/d|strava\.com\/routes|garmin\.com|plotaroute|racemap|onthegomap|ridewithgps|komoot|mapmyrun|umap|racedaymap|livetrail|footpathapp|maps\.app\.goo|IFRAME/i;
const SKIP = /facebook|instagram|youtube|spotify|vimeo|recaptcha|googletagmanager|doubleclick|cookie|linkedin|tiktok/i;

export async function scan({ max = 22 } = {}) {
  const seen = new Set([location.href.split("#")[0]]), hits = new Map();
  const one = (d, base) => {
    const subs = [];
    d.querySelectorAll("a[href],iframe[src],iframe[data-src]").forEach((e) => {
      const h = e.getAttribute("href") || e.getAttribute("src") || e.getAttribute("data-src");
      if (!h || /^(#|mailto|tel|javascript)/.test(h)) return;
      let u; try { u = new URL(h, base); } catch { return; }
      const t = (e.innerText || e.tagName).trim().replace(/\s+/g, " ").slice(0, 30);
      if (F.test(u.href + " " + t) && !SKIP.test(u.href)) hits.set(u.href, t);
      if (u.origin === location.origin && SUB.test(decodeURIComponent(u.pathname) + " " + t) && !/\.(pdf|jpe?g|png|gpx|kml|kmz|zip)$/i.test(u.pathname)) {
        const k = u.href.split("#")[0];
        if (!seen.has(k)) { seen.add(k); subs.push([k, PRI.test(decodeURIComponent(u.pathname) + " " + t)]); }
      }
    });
    return subs;
  };
  const q = one(document, location.href).sort((a, b) => b[1] - a[1]);
  let n = 0;
  while (q.length && n < max) {
    const [s] = q.shift(); n++;
    try { const d = new DOMParser().parseFromString(await (await fetch(s)).text(), "text/html"); q.push(...one(d, s).filter((x) => x[1])); q.sort((a, b) => b[1] - a[1]); } catch {}
  }
  return { site: location.host, n, hits: [...hits].map(([u, t]) => `${t} -> ${u}`).slice(0, 16) };
}

export async function pack(o) {
  const s = JSON.stringify(o); let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const gz = new Uint8Array(await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  let b = ""; for (const x of gz) b += String.fromCharCode(x);
  return btoa(b) + " " + h;
}

/** Extrahera och packa en eller flera filer (samma ursprung). */
export async function grab(urls, opts = {}) {
  const out = [];
  for (const u of [].concat(urls)) {
    try { const r = await extract(u, { maxPts: 240, ...opts }); const names = r.names; delete r.names; out.push(`${u} | ${r.distKm} km | tracks ${r.tracks} ${JSON.stringify(names).slice(0, 80)}\n${await pack(r)}`); }
    catch (e) { out.push(`${u} | ERR ${e.message}`); }
  }
  return out.join("\n");
}

export async function grabDocument(opts = {}) {
  const r = extractDocument({ maxPts: 240, ...opts }); const names = r.names; delete r.names;
  return `${r.distKm} km | tracks ${r.tracks} ${JSON.stringify(names).slice(0, 80)}\n${await pack(r)}`;
}

// ---- Sammansättning (varvbanor, vändpunktsbanor) och spårning längs vägnätet ----
import { parse, summarize } from "./route-extract.mjs";

/** Hämta GPX/KML (samma ursprung) → segment {coords, ele}. */
export async function seg(url, pick = null) {
  const p = parse(await (await fetch(url)).text(), pick);
  return { coords: p.coords, ele: p.ele };
}
export const rev = (s) => ({ coords: [...s.coords].reverse(), ele: [...s.ele].reverse() });
/** Slå ihop segment i ordning (dubblerad skarvpunkt tas bort). */
export function join(...segs) {
  const coords = [], ele = [];
  for (const s of segs) {
    s.coords.forEach((c, i) => {
      const last = coords[coords.length - 1];
      if (i === 0 && last && Math.abs(last[0] - c[0]) < 1e-6 && Math.abs(last[1] - c[1]) < 1e-6) return;
      coords.push(c); ele.push(s.ele[i] ?? null);
    });
  }
  return { coords, ele };
}
/** Spåra längs vägnätet (BRouter, OSM-data, med höjd). lonlats: [[lng,lat],...] */
export async function trace(lonlats, profile = "trekking") {
  const coords = [], ele = [];
  // BRouter klarar många punkter i ett anrop; dela ändå upp för säkerhets skull.
  for (let i = 0; i < lonlats.length - 1; i += 20) {
    const part = lonlats.slice(i, Math.min(i + 21, lonlats.length));
    const u = `https://brouter.de/brouter?lonlats=${part.map((p) => p.join(",")).join("|")}&profile=${profile}&alternativeidx=0&format=geojson`;
    const j = await (await fetch(u)).json();
    const c = j.features[0].geometry.coordinates;
    c.forEach((p, k) => { if (k === 0 && coords.length) return; coords.push([p[0], p[1]]); ele.push(p[2] ?? null); });
  }
  return { coords, ele };
}
/** Förenkla + packa ett sammansatt segment. */
export async function finish(s, opts = {}) {
  const r = summarize(s.coords, s.ele, opts.maxPts ?? 240);
  return `${r.distKm} km | ${r.kept} p\n${await pack(r)}`;
}
