// One-off: country outlines for the home page map, as ready-to-draw SVG paths keyed by ISO alpha-3 code.
// Source: Natural Earth 1:110m countries (public domain) via the world-atlas package; Equal Earth projection.
//   npm i world-atlas@2 topojson-client@3 d3-geo@3 i18n-iso-countries@7 && node scripts/build_worldmap.mjs <path-to-node_modules>
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const base = process.argv[2] || "./node_modules";
const require = createRequire(import.meta.url);
const topojson = require(`${base}/topojson-client`);
const iso = require(`${base}/i18n-iso-countries`);
const { geoEqualEarth, geoPath } = require(`${base}/d3-geo`);
const topo = JSON.parse(readFileSync(`${base}/world-atlas/countries-110m.json`, "utf8"));
const W = 1000, H = 490;
const land = topojson.feature(topo, topo.objects.countries);
const projection = geoEqualEarth().fitExtent([[4, 4], [W - 4, H - 4]], { type: "Sphere" });
const path = geoPath(projection);
const round = d => d.replace(/-?\d+\.\d+/g, n => (+n).toFixed(1));
const byName = { Kosovo: "XKX" };
const out = [];
for (const f of land.features) {
  if (f.properties.name === "Antarctica") continue;
  const code = (f.id !== undefined && iso.numericToAlpha3(String(f.id).padStart(3, "0"))) || byName[f.properties.name] || "";
  const d = path(f); if (!d) continue;
  out.push({ code, name: f.properties.name, d: round(d) });
}
const sphere = round(path({ type: "Sphere" }));
writeFileSync(new URL("../docs/data/worldmap.json", import.meta.url), JSON.stringify({ w: W, h: H, sphere, countries: out }));
console.log(out.length, "shapes;", out.filter(c => !c.code).map(c => c.name).join(", ") || "all coded");
