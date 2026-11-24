// One-off: sample evenly spaced points on land for the home page globe.
// Source: Natural Earth 1:110m land (public domain) via the world-atlas package.
//   npm i world-atlas@2 topojson-client@3 && node scripts/build_land.mjs <path-to-node_modules>
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const base = process.argv[2] || "./node_modules";
const require = createRequire(import.meta.url);
const topojson = require(`${base}/topojson-client`);
const topo = JSON.parse(readFileSync(`${base}/world-atlas/land-110m.json`, "utf8"));
const land = topojson.feature(topo, topo.objects.land);
// A few small islands (Fiji) cross the antimeridian, so their rings jump from +180 to -180.
// Unwrap those rings into continuous longitude; a flat jump (Antarctica's edge at -90) is left alone.
const unwrap = ring => {
  if (!ring.some((c, i) => i && Math.abs(c[0] - ring[i - 1][0]) > 180 && Math.abs(c[1] - ring[i - 1][1]) > 1e-9)) return ring;
  let off = 0;
  return ring.map((c, i) => { if (i) { const d = c[0] - ring[i - 1][0]; if (d > 180) off -= 360; else if (d < -180) off += 360; } return [c[0] + off, c[1]]; });
};
const polys = [];
for (const f of land.features ?? [land]) {
  const g = f.geometry ?? f;
  for (const raw of g.type === "Polygon" ? [g.coordinates] : g.coordinates) {
    const p = raw.map(unwrap), xs = p[0].map(c => c[0]), ys = p[0].map(c => c[1]);
    polys.push({ rings: p, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
}
const inRing = (x, y, r) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const hit = (x, y, p) => x >= p.box[0] && x <= p.box[2] && y >= p.box[1] && y <= p.box[3] && inRing(x, y, p.rings[0]) && !p.rings.slice(1).some(h => inRing(x, y, h));
const onLand = (x, y) => polys.some(p => hit(x, y, p) || hit(x + 360, y, p) || hit(x - 360, y, p));
const STEP = 1.5, out = [];
for (let lat = -88.5; lat <= 88.5; lat += STEP) {
  const n = Math.max(1, Math.round(360 * Math.cos(lat * Math.PI / 180) / STEP));
  for (let i = 0; i < n; i++) {
    const lon = -180 + (i + 0.5) * 360 / n;
    if (onLand(lon, lat)) out.push(Math.round(lon * 10) / 10, Math.round(lat * 10) / 10);
  }
}
writeFileSync(new URL("../docs/data/land.json", import.meta.url), JSON.stringify(out));
console.log(out.length / 2, "land points");
