/* Reading data files in the browser. Nothing leaves the visitor's computer.
   Readers.read(file, { sheet }) resolves to { columns: [names], rows: [[values]], labels: { column: description }, notes: [text], sheets, sheet, format }.
   Values are strings, numbers, booleans, Dates or null. Typing and profiling happen in mydata.js.
   Built in: delimited text (comma, tab, semicolon, pipe, spaces), JSON, JSON Lines, GeoJSON, SPSS .sav/.zsav, Stata .dta, gzip of any of these.
   Loaded on demand from /vendor: spreadsheets (SheetJS) and Parquet (hyparquet).
   Checked against pandas and pyreadstat in tests/check_readers.py. */
const Readers = (() => {
  "use strict";
  const hooks = {};                                                       // tests swap in their own loaders
  const ext = name => (/\.([a-z0-9]+)$/i.exec(name) || [, ""])[1].toLowerCase();
  const SHEETS = new Set("xlsx xlsm xlsb xls xlw ods fods numbers dbf slk sylk dif wk1 wk3 wks 123 wq1 wq2 qpw prn".split(" "));
  const NOT_YET = { sas7bdat: "SAS data files", xpt: "SAS transport files", rds: "R data files", rdata: "R workspaces", rda: "R workspaces", feather: "Feather files", arrow: "Arrow files", sqlite: "SQLite databases", db: "database files", mdb: "Access databases", accdb: "Access databases", pdf: "PDF files", docx: "Word documents", zip: "zip archives", "7z": "archives", rar: "archives" };

  /* ---------- helpers ---------- */
  function decode(u8, notes) {
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return new TextDecoder("utf-8").decode(u8.subarray(3));
    if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder("utf-16le").decode(u8.subarray(2));
    if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder("utf-16be").decode(u8.subarray(2));
    try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); }
    catch (e) { if (notes) notes.push("The file is not UTF-8, so it was read as Windows-1252 (Western European). Check accented letters."); return new TextDecoder("windows-1252").decode(u8); }
  }
  async function pipe(u8, format) { const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream(format)); return new Uint8Array(await new Response(s).arrayBuffer()); }
  const loaded = {};
  const script = src => loaded[src] || (loaded[src] = new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => { delete loaded[src]; no(new Error("A part of the page needed for this file type could not be loaded. Check the connection and try again.")); }; document.head.append(s); }));
  function unique(names) { const seen = new Map(); return names.map((n, i) => { let s = String(n ?? "").trim() || `column ${i + 1}`; if (seen.has(s)) { let k = seen.get(s) + 1; seen.set(s, k); s = `${s} (${k})`; } seen.set(s, 1); return s; }); }

  /* A grid of cells -> header and rows. Finds the header row, which in spreadsheets is often below a title.
     The first row is taken as names unless it plainly reads as data: numbers sitting over columns of numbers. */
  function fromGrid(grid, notes, typed) {
    const has = c => c !== null && c !== undefined && c !== "";
    grid = grid.filter(r => r && r.some(has));
    if (!grid.length) throw new Error("The file has no rows.");
    const width = Math.max(...grid.slice(0, 2000).map(r => r.length)), filled = r => r.filter(has).length;
    const numy = c => typeof c === "number" || (typeof c === "string" && c.trim() !== "" && !isNaN(Number(c.replace(/,/g, ""))));
    const texty = c => has(c) && !numy(c) && !(c instanceof Date);
    let h = 0;
    if (typed) for (let i = 0; i < Math.min(12, grid.length - 1); i++) if (filled(grid[i]) >= Math.max(2, width * 0.6) && grid[i].filter(texty).length >= filled(grid[i]) * 0.8) { h = i; break; }
    const head = grid[h], below = grid.slice(h + 1, h + 201);
    const nums = head.map((c, j) => (numy(c) ? j : -1)).filter(j => j >= 0), vals = nums.map(j => Number(String(head[j]).replace(/,/g, "")));
    const steps = vals.length >= 3 && vals.every(Number.isInteger) && vals.every((v, i) => !i || v - vals[i - 1] === vals[1] - vals[0]) && vals[1] !== vals[0];        // 2019, 2020, 2021: years used as names
    const over = j => { const col = below.map(r => r[j]).filter(has); return col.length ? col.filter(numy).length / col.length : 0; };
    const asData = below.length > 0 && nums.length > 0 && !steps && nums.every(j => over(j) >= 0.8) && head.every((c, j) => !texty(c) || over(j) < 0.5);
    const isHeader = !asData && grid.length > h + 1;
    if (h) notes.push(`Skipped ${h} line${h > 1 ? "s" : ""} above the header row.`);
    if (!isHeader) notes.push("The first row reads as data, not as names, so the columns were numbered.");
    const columns = unique(Array.from({ length: width }, (_, i) => (isHeader && has(head[i]) ? head[i] : `column ${i + 1}`)));
    const rows = grid.slice(isHeader ? h + 1 : h).map(r => { const o = new Array(width).fill(null); for (let i = 0; i < Math.min(width, r.length); i++) o[i] = has(r[i]) ? r[i] : null; return o; });
    const keep = columns.map((_, j) => rows.some(r => r[j] !== null) || (isHeader && has(head[j])));
    if (keep.some(k => !k)) return { columns: columns.filter((_, j) => keep[j]), rows: rows.map(r => r.filter((_, j) => keep[j])) };
    return { columns, rows };
  }

  /* ---------- delimited text ---------- */
  function sniff(text) {
    const sample = text.slice(0, 60000).split(/\r\n|\n|\r/).filter(l => l.trim()).slice(0, 40);
    let best = { d: ",", score: 0 };
    for (const d of [",", "\t", ";", "|"]) {
      const counts = sample.map(l => { let n = 0, q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === d && !q) n++; } return n; });
      const mode = [...counts].sort((a, b) => counts.filter(v => v === b).length - counts.filter(v => v === a).length)[0];
      const score = mode ? counts.filter(c => c === mode).length / counts.length * (1 + Math.min(mode, 20) / 100) : 0;
      if (score > best.score) best = { d, score };
    }
    if (best.score < 0.5) { const sp = sample.map(l => l.trim().split(/\s+/).length); if (sp[0] > 1 && sp.filter(c => c === sp[0]).length / sp.length > 0.8) return " "; }
    return best.score ? best.d : ",";
  }
  function parseDelimited(text, d) {
    const rows = [];
    if (d === " ") { text.split(/\r\n|\n|\r/).forEach(l => { if (l.trim()) rows.push(l.trim().split(/\s+/)); }); return rows; }
    if (text.indexOf('"') < 0) { text.split(/\r\n|\n|\r/).forEach(l => { if (l !== "") rows.push(l.split(d)); }); return rows; }
    let row = [], cur = "", q = false, i = 0; const n = text.length;
    while (i < n) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"' && cur === "") q = true;
      else if (ch === d) { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; }
      else cur += ch;
      i++;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  function text(str, notes) {
    const t = str.replace(/^﻿/, ""), first = t.trimStart()[0];
    if (first === "{" || first === "[") { try { return Object.assign(json(JSON.parse(t), notes), { format: "JSON" }); } catch (e) { if (first === "{" && /\n\s*\{/.test(t)) { try { return Object.assign(lines(t, notes), { format: "JSON Lines" }); } catch (e2) { /* fall through to delimited */ } } } }
    const d = sniff(t), grid = parseDelimited(t, d);
    return Object.assign(fromGrid(grid, notes, false), { format: d === "," ? "CSV" : d === "\t" ? "Tab-separated text" : d === ";" ? "Semicolon-separated text" : d === "|" ? "Pipe-separated text" : "Space-separated text" });
  }

  /* ---------- JSON ---------- */
  const plain = v => v === null || typeof v !== "object" || v instanceof Date;
  function flat(o, out = {}, pre = "", depth = 0) {
    for (const k of Object.keys(o)) { const v = o[k], key = pre + k; if (plain(v)) out[key] = v; else if (!Array.isArray(v) && depth < 2) flat(v, out, key + ".", depth + 1); else out[key] = Array.isArray(v) && v.every(plain) && v.length <= 12 ? v.join("; ") : JSON.stringify(v); }
    return out;
  }
  function objects(list) {
    const cols = [], pos = new Map(), rows = [];
    for (const item of list) { const f = plain(item) ? { value: item } : Array.isArray(item) ? Object.fromEntries(item.map((v, i) => [`column ${i + 1}`, v])) : flat(item); const r = []; for (const k of Object.keys(f)) { let j = pos.get(k); if (j === undefined) { j = cols.length; pos.set(k, j); cols.push(k); } r[j] = f[k] === undefined ? null : f[k]; } rows.push(r); }
    return { columns: unique(cols), rows: rows.map(r => { const o = new Array(cols.length).fill(null); r.forEach((v, j) => { o[j] = v; }); return o; }) };
  }
  function json(j, notes) {
    if (Array.isArray(j)) { if (j.length && j.every(Array.isArray)) return fromGrid(j, notes, true); return objects(j); }
    if (!j || typeof j !== "object") throw new Error("The JSON holds a single value, not a table.");
    if (j.type === "FeatureCollection" && Array.isArray(j.features)) {
      notes.push("GeoJSON: each feature is a row. Points also get longitude and latitude columns; other shapes keep only their properties.");
      return objects(j.features.map(f => { const g = f.geometry || {}, p = { ...(f.properties || {}) }; if (f.id !== undefined && p.id === undefined) p.id = f.id; p.geometry_type = g.type || null; if (g.type === "Point" && Array.isArray(g.coordinates)) { p.longitude = g.coordinates[0]; p.latitude = g.coordinates[1]; } return p; }));
    }
    const ent = Object.entries(j), arrs = ent.filter(([, v]) => Array.isArray(v));
    if (arrs.length >= 2 && arrs.length === ent.length && arrs.every(([, v]) => v.length === arrs[0][1].length && v.every(plain))) return { columns: unique(arrs.map(a => a[0])), rows: arrs[0][1].map((_, i) => arrs.map(a => a[1][i])) };
    const find = (o, depth) => { let best = null; for (const [k, v] of Object.entries(o)) { if (Array.isArray(v) && v.length && v.some(x => x && typeof x === "object")) { if (!best || v.length > best.v.length) best = { k, v }; } else if (v && typeof v === "object" && !Array.isArray(v) && depth < 2) { const inner = find(v, depth + 1); if (inner && (!best || inner.v.length > best.v.length)) best = { k: k + "." + inner.k, v: inner.v }; } } return best; };
    const hit = find(j, 0);
    if (hit) { notes.push(`Read the list found under "${hit.k}".`); return json(hit.v, notes); }
    if (ent.length && ent.every(([, v]) => v && typeof v === "object" && !Array.isArray(v))) { notes.push('The file is a set of named records, so each name became a row in a "key" column.'); return objects(ent.map(([k, v]) => ({ key: k, ...v }))); }
    return objects([j]);
  }
  function lines(t, notes) { const list = []; t.split(/\r\n|\n|\r/).forEach((l, i) => { if (l.trim()) { try { list.push(JSON.parse(l)); } catch (e) { throw new Error(`Line ${i + 1} is not valid JSON.`); } } }); return objects(list); }

  /* ---------- spreadsheets (SheetJS, loaded on demand) ---------- */
  async function sheet(buf, opt, notes) {
    if (typeof XLSX === "undefined" || !XLSX.read) await script("vendor/xlsx.full.min.js");
    const wb = XLSX.read(buf, { type: "array", cellNF: true, cellText: false });
    const names = wb.SheetNames.filter(n => wb.Sheets[n] && wb.Sheets[n]["!ref"]);
    if (!names.length) throw new Error("The workbook has no sheet with data.");
    const cellsIn = n => { const r = XLSX.utils.decode_range(wb.Sheets[n]["!ref"]); return (r.e.r - r.s.r + 1) * (r.e.c - r.s.c + 1); };
    const pick = opt.sheet && names.includes(opt.sheet) ? opt.sheet : [...names].sort((a, b) => cellsIn(b) - cellsIn(a))[0];        // the fullest sheet, not a cover page
    /* cells -> grid. Dates are rebuilt from the stored day number, so they do not shift with the visitor's time zone. */
    const ws = wb.Sheets[pick], d1904 = !!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904), grid = [];
    for (const addr in ws) {
      if (addr[0] === "!") continue; const cell = ws[addr]; if (!cell || cell.t === "z" || cell.t === "e" || cell.v === undefined) continue;
      const at = XLSX.utils.decode_cell(addr); let v = cell.v;
      if (cell.t === "n" && cell.z && XLSX.SSF.is_date(cell.z)) v = new Date(Math.round((cell.v - 25569 + (d1904 ? 1462 : 0)) * 864e5));
      else if (v instanceof Date) v = new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds()));
      (grid[at.r] || (grid[at.r] = []))[at.c] = v;
    }
    for (let r = 0; r < grid.length; r++) { const row = grid[r] || []; for (let c = 0; c < row.length; c++) if (row[c] === undefined) row[c] = null; grid[r] = row; }
    if (names.length > 1) notes.push(`The workbook has ${names.length} sheets. Showing "${pick}"${opt.sheet ? "" : ", the fullest one"}; switch sheets in the bar above.`);
    return Object.assign(fromGrid(grid, notes, true), { sheets: names, sheet: pick, format: "Spreadsheet" });
  }

  /* ---------- Parquet (hyparquet, loaded on demand) ---------- */
  async function parquet(buf) {
    const lib = await (hooks.parquet ? hooks.parquet() : import(new URL("vendor/hyparquet.min.js", document.baseURI).href));
    const list = await lib.parquetReadObjects({ file: buf, compressors: lib.compressors });
    const fix = v => (typeof v === "bigint" ? (v >= -9007199254740991n && v <= 9007199254740991n ? Number(v) : v.toString()) : v instanceof Uint8Array ? `[${v.length} bytes]` : v);
    list.forEach(o => { for (const k in o) o[k] = fix(o[k]); });
    return Object.assign(objects(list), { format: "Parquet" });
  }

  /* When every distinct value of a column has a label, the column is a category: show the labels. Otherwise keep the numbers. */
  function applyLabels(rows, j, map) {
    if (!map || !map.size) return false;
    const seen = new Set(); for (const r of rows) if (r[j] !== null) { seen.add(r[j]); if (seen.size > 400) return false; }
    if (!seen.size || ![...seen].every(v => map.has(v))) return false;
    for (const r of rows) if (r[j] !== null) r[j] = map.get(r[j]);
    return true;
  }

  /* ---------- SPSS .sav and .zsav ---------- */
  async function sav(u8, notes) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), magic = String.fromCharCode(...u8.subarray(0, 4));
    if (magic !== "$FL2" && magic !== "$FL3") throw new Error("This does not look like an SPSS data file.");
    let le = true; if (![2, 3].includes(dv.getInt32(64, true))) { le = false; if (![2, 3].includes(dv.getInt32(64, false))) throw new Error("This SPSS file has a layout this page does not know."); }
    const i32 = o => dv.getInt32(o, le), f64 = o => dv.getFloat64(o, le), compression = i32(72), ncases = i32(80), bias = f64(84);
    let pos = 176, enc = "windows-1252";
    const slots = [], vlabels = [], longNames = new Map(), veryLong = new Map();
    const bytes = (o, n) => u8.subarray(o, o + n);
    const pending = [];                                                    // texts decoded once the encoding is known
    for (;;) {
      const type = i32(pos); pos += 4;
      if (type === 2) {
        const width = i32(pos), hasLabel = i32(pos + 4), nmiss = i32(pos + 8), print = i32(pos + 12), name = bytes(pos + 20, 8); pos += 28;
        const s = { width, name, fmt: (print >> 16) & 0xff, label: null };
        if (hasLabel) { const len = i32(pos); s.label = bytes(pos + 4, len); pos += 4 + Math.ceil(len / 4) * 4; }
        pos += Math.abs(nmiss) * 8; slots.push(s);
      } else if (type === 3) {
        const n = i32(pos); pos += 4; const items = [];
        for (let k = 0; k < n; k++) { const val = bytes(pos, 8), len = u8[pos + 8]; items.push([val, bytes(pos + 9, len)]); pos += 8 + Math.ceil((len + 1) / 8) * 8; }
        if (i32(pos) !== 4) throw new Error("The SPSS file's value labels are damaged."); const m = i32(pos + 4), vars = []; for (let k = 0; k < m; k++) vars.push(i32(pos + 8 + 4 * k) - 1); pos += 8 + 4 * m;
        vlabels.push({ items, vars });
      } else if (type === 6) { pos += 4 + i32(pos) * 80; }
      else if (type === 7) {
        const sub = i32(pos), size = i32(pos + 4), count = i32(pos + 8), data = bytes(pos + 12, size * count); pos += 12 + size * count;
        if (sub === 20) enc = String.fromCharCode(...data).trim() || enc;
        else if (sub === 3 && count >= 8 && dv.getInt32(data.byteOffset - u8.byteOffset + 28, le) === 65001) enc = "utf-8";
        else if (sub === 13) pending.push(d => d(data).split("\t").forEach(p => { const k = p.indexOf("="); if (k > 0) longNames.set(p.slice(0, k).trim().toUpperCase(), p.slice(k + 1)); }));
        else if (sub === 14) pending.push(d => d(data).split("\0\t").forEach(p => { const k = p.indexOf("="); if (k > 0) veryLong.set(p.slice(0, k).trim().toUpperCase(), parseInt(p.slice(k + 1), 10)); }));
      } else if (type === 999) { pos += 4; break; }
      else throw new Error("The SPSS file has a record this page cannot read.");
    }
    let td; try { td = new TextDecoder(enc); } catch (e) { td = new TextDecoder("windows-1252"); }
    const str = b => td.decode(b).replace(/\0+$/, "").replace(/ +$/, "");
    pending.forEach(f => f(b => td.decode(b)));
    /* variables: a string of width w takes ceil(w / 8) slots, the extra ones marked -1 */
    const vars = []; slots.forEach((s, i) => { if (s.width >= 0) vars.push({ slot: i, width: s.width, n: s.width > 0 ? Math.ceil(s.width / 8) : 1, short: str(s.name).toUpperCase(), fmt: s.fmt, label: s.label ? str(s.label) : "", labels: null }); });
    vlabels.forEach(vl => vl.vars.forEach(si => { const v = vars.find(x => x.slot === si); if (!v) return; v.labels = new Map(vl.items.map(([val, lab]) => [v.width ? str(val) : new DataView(val.buffer, val.byteOffset, 8).getFloat64(0, le), str(lab)])); }));
    /* data elements */
    let data = u8.subarray(pos);
    if (compression === 2) {
      const zt = Number(dv.getBigInt64(pos + 8, le)), nb = i32(zt + 20), parts = []; let total = 0;
      for (let b = 0; b < nb; b++) { const o = zt + 24 + b * 24, cofs = Number(dv.getBigInt64(o + 8, le)), csize = i32(o + 20), part = await pipe(bytes(cofs, csize), "deflate"); parts.push(part); total += part.length; }
      data = new Uint8Array(total); let at = 0; parts.forEach(p => { data.set(p, at); at += p.length; });
    }
    const per = slots.length, SYSMIS = -Number.MAX_VALUE, rows = [], dd = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const DATE = new Set([20, 22, 23, 24, 28, 29, 30, 38, 39, 41]), SPACES = new Uint8Array(8).fill(32);
    const emit = el8 => {                                                // el8: array of per slots, each a number, null or Uint8Array(8)
      const r = [];
      for (const v of vars) {
        if (!v.width) { const x = el8[v.slot]; r.push(x === null || x === SYSMIS || (typeof x === "number" && isNaN(x)) ? null : DATE.has(v.fmt) ? new Date((x - 12219379200) * 1000) : x); }
        else { const buf = new Uint8Array(v.n * 8); for (let k = 0; k < v.n; k++) { const x = el8[v.slot + k]; buf.set(x instanceof Uint8Array ? x : SPACES, k * 8); } const s = str(buf.subarray(0, v.width)); r.push(s === "" ? null : s); }
      }
      rows.push(r);
    };
    if (compression === 0) { for (let o = 0; o + per * 8 <= data.length; o += per * 8) { const e = new Array(per); for (let k = 0; k < per; k++) e[k] = slots[k].width === 0 ? dd.getFloat64(o + 8 * k, le) : data.subarray(o + 8 * k, o + 8 * k + 8); emit(e); } }
    else {
      let o = 0, e = [], done = false;
      while (!done && o < data.length) {
        const cmd = data.subarray(o, o + 8); o += 8;
        for (let c = 0; c < cmd.length && !done; c++) {
          const code = cmd[c], numeric = slots[e.length].width === 0;
          if (code === 0) continue;
          if (code === 252) { done = true; break; }
          if (code === 253) { e.push(numeric ? dd.getFloat64(o, le) : data.subarray(o, o + 8)); o += 8; }
          else if (code === 254) e.push(numeric ? null : SPACES);
          else if (code === 255) e.push(null);
          else e.push(numeric ? code - bias : SPACES);
          if (e.length === per) { emit(e); e = []; }
        }
      }
    }
    /* very long strings are stored as several 255-byte pieces: join them and drop the extra columns */
    const drop = new Set();
    vars.forEach((v, j) => { const len = veryLong.get(v.short); if (!len) return; const pieces = Math.ceil(len / 252); for (let k = 1; k < pieces && j + k < vars.length; k++) { drop.add(j + k); for (const r of rows) r[j] = (r[j] || "") + (r[j + k] || ""); } for (const r of rows) if (r[j] === "") r[j] = null; });
    let labelled = 0; vars.forEach((v, j) => { if (!drop.has(j) && applyLabels(rows, j, v.labels)) labelled++; });
    if (labelled) notes.push(`${labelled} coded column${labelled > 1 ? "s were" : " was"} shown with ${labelled > 1 ? "their" : "its"} value labels (for example 1 becomes "Yes").`);
    if (ncases >= 0 && ncases !== rows.length) notes.push(`The file says it holds ${ncases} rows; ${rows.length} were read.`);
    const keep = vars.map((_, j) => !drop.has(j)), names = unique(vars.filter((_, j) => keep[j]).map(v => longNames.get(v.short) || v.short)), labels = {};
    vars.filter((_, j) => keep[j]).forEach((v, k) => { if (v.label) labels[names[k]] = v.label; });
    return { columns: names, rows: drop.size ? rows.map(r => r.filter((_, j) => keep[j])) : rows, labels, format: compression === 2 ? "SPSS (compressed)" : "SPSS" };
  }

  /* ---------- Stata .dta (formats 113 to 115 and 117 to 119) ---------- */
  function dta(u8, notes) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), head = String.fromCharCode(...u8.subarray(0, 11));
    let le = true, ver, K, N, o, types = [], names = [], fmts = [], lblnames = [], vlabels = [], dataAt, strlAt = 0, vlAt, end = u8.length, td;
    const u16 = p => dv.getUint16(p, le), u32 = p => dv.getUint32(p, le), i32 = p => dv.getInt32(p, le), u64 = p => Number(dv.getBigUint64(p, le));
    const zstr = (p, n) => { let e = p; while (e < p + n && u8[e]) e++; return td.decode(u8.subarray(p, e)); };
    const find = tag => { const t = new TextEncoder().encode(tag); outer: for (let i = 0; i < Math.min(u8.length, 4000); i++) { for (let k = 0; k < t.length; k++) if (u8[i + k] !== t[k]) continue outer; return i + t.length; } throw new Error("The Stata file is damaged or in a format this page does not know."); };
    if (head === "<stata_dta>") {
      ver = +String.fromCharCode(...u8.subarray(find("<release>"), find("<release>") + 3)); le = String.fromCharCode(...u8.subarray(find("<byteorder>"), find("<byteorder>") + 3)) === "LSF";
      if (![117, 118, 119].includes(ver)) throw new Error(`Stata format ${ver} is not supported yet. Save the file as an older version or as CSV.`);
      td = new TextDecoder(ver >= 118 ? "utf-8" : "windows-1252");
      o = find("<K>"); K = ver === 119 ? u32(o) : u16(o); o = find("<N>"); N = ver === 117 ? u32(o) : u64(o);
      const m = find("<map>"), at = k => u64(m + 8 * k), W = ver === 117 ? [33, 49, 33, 81] : [129, 57, 129, 321];
      const body = (k, tag) => at(k) + tag.length;
      o = body(2, "<variable_types>"); for (let j = 0; j < K; j++) types.push(u16(o + 2 * j));
      o = body(3, "<varnames>"); for (let j = 0; j < K; j++) names.push(zstr(o + W[0] * j, W[0]));
      o = body(5, "<formats>"); for (let j = 0; j < K; j++) fmts.push(zstr(o + W[1] * j, W[1]));
      o = body(6, "<value_label_names>"); for (let j = 0; j < K; j++) lblnames.push(zstr(o + W[2] * j, W[2]));
      o = body(7, "<variable_labels>"); for (let j = 0; j < K; j++) vlabels.push(zstr(o + W[3] * j, W[3]));
      dataAt = body(9, "<data>"); strlAt = body(10, "<strls>"); vlAt = body(11, "<value_labels>"); end = at(12);
    } else {
      ver = u8[0]; if (![113, 114, 115].includes(ver)) throw new Error("This does not look like a Stata data file this page can read (it reads Stata 8 and later).");
      le = u8[1] === 2; td = new TextDecoder("windows-1252"); K = u16(4); N = u32(6); o = 10 + 81 + 18;
      const fw = ver === 113 ? 12 : 49;
      for (let j = 0; j < K; j++) { const t = u8[o + j]; types.push(t <= 244 ? t : { 251: 65530, 252: 65529, 253: 65528, 254: 65527, 255: 65526 }[t]); } o += K;
      for (let j = 0; j < K; j++) names.push(zstr(o + 33 * j, 33)); o += 33 * K + 2 * (K + 1);
      for (let j = 0; j < K; j++) fmts.push(zstr(o + fw * j, fw)); o += fw * K;
      for (let j = 0; j < K; j++) lblnames.push(zstr(o + 33 * j, 33)); o += 33 * K;
      for (let j = 0; j < K; j++) vlabels.push(zstr(o + 81 * j, 81)); o += 81 * K;
      for (;;) { const t = u8[o], len = i32(o + 1); o += 5; if (!t && !len) break; o += len; }                // expansion fields
      dataAt = o;
    }
    const width = t => (t <= 2045 ? t : t === 32768 ? 8 : t === 65526 ? 8 : t === 65527 || t === 65528 ? 4 : t === 65529 ? 2 : 1), rowBytes = types.reduce((s, t) => s + width(t), 0);
    /* long strings live after the data, keyed by (variable, observation) */
    const strls = new Map();
    if (strlAt && types.includes(32768)) { let p = strlAt; while (p + 3 <= u8.length && u8[p] === 71 && u8[p + 1] === 83 && u8[p + 2] === 79) { const v = u32(p + 3); let ob, q; if (ver === 117) { ob = u32(p + 7); q = p + 11; } else { ob = u64(p + 7); q = p + 15; } const t = u8[q], len = u32(q + 1); strls.set(v + ":" + ob, t === 130 ? td.decode(u8.subarray(q + 5, q + 5 + len - 1)) : `[${len} bytes]`); p = q + 5 + len; } }
    const DAY = 864e5, base = Date.UTC(1960, 0, 1);
    const conv = fmts.map(f => { const m = /^%-?t([cCdmqwh])/.exec(f) || (/^%-?d/.test(f) ? [, "d"] : null); if (!m) return null; const k = m[1]; return k === "d" ? x => new Date(base + x * DAY) : k === "c" || k === "C" ? x => new Date(base + x) : k === "m" ? x => new Date(Date.UTC(1960 + Math.floor(x / 12), ((x % 12) + 12) % 12, 1)) : k === "q" ? x => new Date(Date.UTC(1960 + Math.floor(x / 4), (((x % 4) + 4) % 4) * 3, 1)) : k === "w" ? x => new Date(Date.UTC(1960 + Math.floor(x / 52), 0, 1) + (((x % 52) + 52) % 52) * 7 * DAY) : x => new Date(Date.UTC(1960 + Math.floor(x / 2), (((x % 2) + 2) % 2) * 6, 1)); });
    const rows = new Array(N);
    for (let r = 0, p = dataAt; r < N; r++) {
      const row = new Array(K);
      for (let j = 0; j < K; j++) {
        const t = types[j]; let v;
        if (t <= 2045) { v = zstr(p, t); p += t; if (v === "") v = null; }
        else if (t === 32768) {                                         // a pointer (variable, observation) into the long strings
          let vv = 0, ob = 0;
          if (ver === 117) { vv = u32(p); ob = u32(p + 4); }
          else { const nv = ver === 119 ? 3 : 2; if (le) { for (let k = nv - 1; k >= 0; k--) vv = vv * 256 + u8[p + k]; for (let k = 7; k >= nv; k--) ob = ob * 256 + u8[p + k]; } else { for (let k = 0; k < nv; k++) vv = vv * 256 + u8[p + k]; for (let k = nv; k < 8; k++) ob = ob * 256 + u8[p + k]; } }
          v = vv || ob ? strls.get(vv + ":" + ob) ?? null : null; if (v === "") v = null; p += 8;
        }
        else {
          if (t === 65526) { v = dv.getFloat64(p, le); p += 8; if (!(v < 8.988e307)) v = null; }
          else if (t === 65527) { v = dv.getFloat32(p, le); p += 4; if (!(v < 1.701e38)) v = null; else v = +v.toPrecision(8); }
          else if (t === 65528) { v = dv.getInt32(p, le); p += 4; if (v > 2147483620) v = null; }
          else if (t === 65529) { v = dv.getInt16(p, le); p += 2; if (v > 32740) v = null; }
          else { v = dv.getInt8(p); p += 1; if (v > 100) v = null; }
          if (v !== null && conv[j]) v = conv[j](v);
        }
        row[j] = v;
      }
      rows[r] = row;
    }
    /* value labels */
    const tables = new Map(); let p = vlAt !== undefined ? vlAt : dataAt + rowBytes * N;
    const nameW = ver >= 118 ? 129 : 33;
    while (p + 8 < end) {
      if (ver >= 117) { if (!(u8[p] === 60 && u8[p + 1] === 108)) break; p += 5; }                               // "<lbl>"
      const len = i32(p), name = zstr(p + 4, nameW), tb = p + 4 + nameW + 3, n = i32(tb), txt = tb + 8 + 8 * n, map = new Map();
      if (len <= 0 || n < 0 || txt > end) break;
      for (let k = 0; k < n; k++) map.set(i32(tb + 8 + 4 * n + 4 * k), zstr(txt + i32(tb + 8 + 4 * k), 32000));
      tables.set(name, map); p = tb + len; if (ver >= 117) p += 6;                                                // "</lbl>"
    }
    let labelled = 0; lblnames.forEach((nm, j) => { if (nm && types[j] > 2045 && types[j] !== 32768 && !conv[j] && applyLabels(rows, j, tables.get(nm))) labelled++; });
    if (labelled) notes.push(`${labelled} coded column${labelled > 1 ? "s were" : " was"} shown with ${labelled > 1 ? "their" : "its"} value labels (for example 1 becomes "Yes").`);
    const cols = unique(names), labels = {}; vlabels.forEach((l, j) => { if (l) labels[cols[j]] = l; });
    return { columns: cols, rows, labels, format: `Stata (format ${ver})` };
  }

  /* ---------- entry point ---------- */
  async function read(file, opt = {}) {
    let name = file.name || "pasted table", u8 = new Uint8Array(await file.arrayBuffer()); const notes = [];
    if (!u8.length) throw new Error("The file is empty.");
    if (u8[0] === 0x1f && u8[1] === 0x8b) { u8 = await pipe(u8, "gzip"); name = name.replace(/\.gz$/i, ""); notes.push("Unpacked from gzip."); }
    const e = ext(name), magic = String.fromCharCode(...u8.subarray(0, 4)), zip = magic === "PK\u0003\u0004", ole = u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0;
    let out;
    if (magic === "PAR1") out = await parquet(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
    else if (magic === "$FL2" || magic === "$FL3") out = await sav(u8, notes);
    else if (e === "dta" || String.fromCharCode(...u8.subarray(0, 11)) === "<stata_dta>") out = dta(u8, notes);
    else if (SHEETS.has(e) || ole || (zip && !NOT_YET[e])) out = await sheet(u8, opt, notes);
    else if (NOT_YET[e]) throw new Error(`${NOT_YET[e][0].toUpperCase() + NOT_YET[e].slice(1)} cannot be read here yet. Export the table as CSV, Excel, Parquet, SPSS or Stata and open that instead.`);
    else if (e === "jsonl" || e === "ndjson") out = Object.assign(lines(decode(u8, notes), notes), { format: "JSON Lines" });
    else if (e === "json" || e === "geojson") out = Object.assign(json(JSON.parse(decode(u8, notes)), notes), { format: e === "geojson" ? "GeoJSON" : "JSON" });
    else { let nul = 0; for (let i = 0; i < Math.min(u8.length, 4000); i++) if (u8[i] === 0) nul++; if (nul > 40 && !(u8[0] === 0xFF && u8[1] === 0xFE) && !(u8[0] === 0xFE && u8[1] === 0xFF)) throw new Error("This looks like a binary file in a format this page does not read. Export the table as CSV, Excel, Parquet, SPSS or Stata."); out = text(decode(u8, notes), notes); }
    if (!out.columns.length || !out.rows.length) throw new Error("No table was found in the file.");
    return Object.assign({ labels: {}, notes: [] }, out, { notes: notes.concat(out.notes || []), name });
  }

  return { read, hooks, text: (s, notes = []) => Object.assign({ labels: {}, name: "pasted table" }, text(s, notes), { notes }), _: { sav, dta, json, lines, text, sniff, parseDelimited, fromGrid } };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Readers;
