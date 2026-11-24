// Reads each file named on the command line with the site's own readers and prints what came out; used by check_readers.py.
const fs = require("fs"), path = require("path");
globalThis.XLSX = require("../docs/vendor/xlsx.full.min.js");
const Readers = require("../docs/assets/readers.js");
Readers.hooks.parquet = () => import(path.resolve(__dirname, "../docs/vendor/hyparquet.min.js"));
const enc = v => (v instanceof Date ? { $date: v.toISOString() } : typeof v === "number" && !isFinite(v) ? null : v);
(async () => {
  const out = {};
  for (const f of process.argv.slice(2)) {
    try {
      const buf = fs.readFileSync(f), t = await Readers.read({ name: path.basename(f), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
      out[path.basename(f)] = { columns: t.columns, rows: t.rows.map(r => r.map(enc)), notes: t.notes, labels: t.labels, format: t.format };
    } catch (e) { out[path.basename(f)] = { error: String(e.message || e) }; }
  }
  process.stdout.write(JSON.stringify(out));
})();
