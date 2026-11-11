// Sparar en bana från route-extract.mjs-resultat (JSON på stdin) som public/races/<id>-<år>.json.
// Användning: node tools/save-course.mjs <race-id> <år> <käll-URL> [officiell-km] < extract.json
import fs from "node:fs";
import path from "node:path";

const [id, year, source, officialKm] = process.argv.slice(2);
if (!id || !year || !source) {
  console.error("usage: save-course.mjs <race-id> <year> <source-url> [officialKm] < extract.json");
  process.exit(1);
}
const r = JSON.parse(fs.readFileSync(0, "utf8"));
if (!r.poly || !r.start || !r.end) throw new Error("extract-resultatet saknar poly/start/end");
const out = {
  v: 1,
  race: id,
  year: Number(year),
  source,
  measuredKm: r.distKm,
  start: r.start,
  end: r.end,
  poly: r.poly,
  ele: r.ele ?? "",
};
const file = path.join("public", "races", `${id}-${year}.json`);
fs.writeFileSync(file, JSON.stringify(out) + "\n");
const diff = officialKm ? ` (officiell ${officialKm} km, diff ${(((r.distKm - officialKm) / officialKm) * 100).toFixed(1)} %)` : "";
console.log(`${file}: ${r.distKm} km, ${r.kept ?? "?"} punkter${diff}`);
