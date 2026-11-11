// Verktyg för att ta fram loppbanor (körs i webbläsaren på arrangörens sida,
// inte i appen). Hämtar GPX/KML (även zippad), mäter distans, förenklar och
// kodar banan kompakt (Google encoded polyline, 1e5) + höjd i hela meter.
// Används av Claude vid inläggning av banor i src/lib/race/catalog.ts.

function enc(values) {
  let out = "";
  for (let v of values) {
    v = v < 0 ? ~(v << 1) : v << 1;
    while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    out += String.fromCharCode(v + 63);
  }
  return out;
}
function encodeLine(coords) {
  const d = []; let pl = 0, pn = 0;
  for (const [lng, lat] of coords) { const a = Math.round(lat * 1e5), b = Math.round(lng * 1e5); d.push(a - pl, b - pn); pl = a; pn = b; }
  return enc(d);
}
function encodeEle(ele) { const d = []; let p = 0; for (const e of ele) { const v = Math.round(e); d.push(v - p); p = v; } return enc(d); }

async function unzip(buf) {
  const dv = new DataView(buf.buffer);
  let e = buf.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  let cd = dv.getUint32(e + 16, true); const cnt = dv.getUint16(e + 10, true);
  for (let k = 0; k < cnt; k++) {
    const method = dv.getUint16(cd + 10, true), csize = dv.getUint32(cd + 20, true), nlen = dv.getUint16(cd + 28, true),
      xlen = dv.getUint16(cd + 30, true), clen = dv.getUint16(cd + 32, true), off = dv.getUint32(cd + 42, true);
    const name = new TextDecoder().decode(buf.slice(cd + 46, cd + 46 + nlen));
    if (/\.(gpx|kml)$/i.test(name) && !/__MACOSX/.test(name)) {
      const st = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const data = buf.slice(st, st + csize);
      return method === 0 ? new TextDecoder().decode(data)
        : await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
    }
    cd += 46 + nlen + xlen + clen;
  }
  throw new Error("ingen gpx/kml i zip");
}

/** Läs text (GPX/KML) → punkter. `pick` väljer spår om filen har flera (index). */
export function parse(text, pick = null) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const tracks = [...doc.getElementsByTagNameNS("*", "trk"), ...doc.getElementsByTagNameNS("*", "rte")];
  const names = tracks.map((t) => t.getElementsByTagNameNS("*", "name")[0]?.textContent?.trim() ?? "");
  let pts;
  if (tracks.length) {
    const scope = pick !== null ? [tracks[pick]] : tracks;
    pts = scope.flatMap((t) => [...t.getElementsByTagNameNS("*", "trkpt"), ...t.getElementsByTagNameNS("*", "rtept")]);
  } else pts = [];
  const coords = [], ele = [];
  if (pts.length) {
    for (const p of pts) {
      coords.push([+p.getAttribute("lon"), +p.getAttribute("lat")]);
      const el = p.getElementsByTagNameNS("*", "ele")[0];
      ele.push(el ? +el.textContent : null);
    }
  } else {
    const lines = [...doc.getElementsByTagNameNS("*", "LineString")];
    const scope = pick !== null ? [lines[pick]] : lines;
    for (const ls of scope) {
      const c = ls.getElementsByTagNameNS("*", "coordinates")[0];
      for (const t of c.textContent.trim().split(/\s+/)) {
        const [lo, la, al] = t.split(",").map(Number);
        coords.push([lo, la]); ele.push(Number.isFinite(al) && al !== 0 ? al : null);
      }
    }
  }
  return { coords, ele, names, tracks: tracks.length };
}

export function summarize(coords, ele, maxPts = 320) {
  if (coords.length < 2) throw new Error("för få punkter");
  const R = 6371.0088, rad = (d) => (d * Math.PI) / 180;
  const hav = (a, b) => { const s = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(s))); };
  let dist = 0; for (let i = 1; i < coords.length; i++) dist += hav(coords[i - 1], coords[i]);
  const lat0 = rad(coords.reduce((s, c) => s + c[1], 0) / coords.length), kx = 111320 * Math.cos(lat0), ky = 110540;
  const xs = coords.map((c) => c[0] * kx), ys = coords.map((c) => c[1] * ky);
  const dp = (tol) => {
    const keep = new Uint8Array(coords.length); keep[0] = keep[coords.length - 1] = 1; const st = [[0, coords.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); const dx = xs[b] - xs[a], dy = ys[b] - ys[a], l2 = dx * dx + dy * dy; let m = -1, idx = -1;
      for (let i = a + 1; i < b; i++) { let px = xs[i] - xs[a], py = ys[i] - ys[a]; if (l2 > 0) { const t = Math.max(0, Math.min(1, (px * dx + py * dy) / l2)); px -= t * dx; py -= t * dy; } const d = px * px + py * py; if (d > m) { m = d; idx = i; } }
      if (idx >= 0 && m > tol * tol) { keep[idx] = 1; st.push([a, idx], [idx, b]); }
    }
    const out = []; keep.forEach((k, i) => k && out.push(i)); return out;
  };
  let tol = 2, idx = dp(tol); while (idx.length > maxPts) { tol *= 1.3; idx = dp(tol); }
  const known = ele.filter((v) => v !== null);
  const hasEle = known.length > ele.length * 0.8;
  let filled = null;
  if (hasEle) { filled = []; let last = known[0]; for (const v of ele) { if (v !== null) last = v; filled.push(last); } }
  const line = idx.map((i) => coords[i]);
  return {
    n: coords.length, kept: idx.length, tolM: +tol.toFixed(1), distKm: +dist.toFixed(3),
    start: line[0].map((v) => +v.toFixed(5)), end: line[line.length - 1].map((v) => +v.toFixed(5)),
    poly: encodeLine(line), ele: filled ? encodeEle(idx.map((i) => filled[i])) : null,
  };
}

/** Hämta + bearbeta. `url` relativ till sidan (samma ursprung) eller "text:" för redan hämtad text. */
export async function extract(url, { pick = null, maxPts = 320 } = {}) {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const text = buf[0] === 0x50 && buf[1] === 0x4b ? await unzip(buf) : new TextDecoder().decode(buf);
  const p = parse(text, pick);
  return { tracks: p.tracks, names: p.names, ...summarize(p.coords, p.ele, maxPts) };
}

/** Bearbeta sidan som redan visar en GPX/KML (navigerat direkt till filen). */
export function extractDocument({ pick = null, maxPts = 320 } = {}) {
  const text = new XMLSerializer().serializeToString(document);
  const p = parse(text, pick);
  return { tracks: p.tracks, names: p.names, ...summarize(p.coords, p.ele, maxPts) };
}
