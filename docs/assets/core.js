/* Shared by every page: small helpers, the light/dark switch, the dataset loader and the chip picker. */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const day = t => String(t).slice(0, 10);
const size = b => b < 1e6 ? `${Math.max(1, Math.round(b / 1e3))} KB` : `${(b / 1e6).toFixed(1)} MB`;
const empty = v => v === "" || v === undefined || (typeof v === "number" && isNaN(v));
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ---------- light / dark ---------- */
(function () {
  const root = document.documentElement, btn = $("#theme");
  const label = () => { if (!btn) return; const dark = root.dataset.theme === "dark"; btn.textContent = dark ? "Light" : "Dark"; btn.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} mode`); };
  if (btn) btn.onclick = () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch (e) { /* private mode: the choice lasts for this page only */ }
    label(); document.dispatchEvent(new Event("themechange"));
  };
  label();
  // the menu button that replaces the row of links on narrow screens
  const menu = $("#menu"), nav = $("#nav");
  if (menu && nav) {
    const set = open => { nav.classList.toggle("open", open); menu.setAttribute("aria-expanded", open); menu.textContent = open ? "Close" : "Menu"; };
    menu.onclick = () => set(!nav.classList.contains("open"));
    document.addEventListener("keydown", e => { if (e.key === "Escape") set(false); });
    document.addEventListener("click", e => { if (!e.target.closest("header.top")) set(false); });
  }
})();
const SITE = "https://sahiljangra12.github.io/open-data-company/";
const plural = (n, w) => `${n.toLocaleString("en-US")} ${w}${n === 1 ? "" : "s"}`;
/* one entry of the change log as a sentence */
function changeLine(c) {
  if (c.new_dataset) return `new dataset with ${plural(c.rows, "row")}`;
  if (c.note) return c.note;
  const bits = [];
  if (c.added) bits.push(`${plural(c.added, "row")} added`);
  if (c.removed) bits.push(`${plural(c.removed, "row")} dropped`);
  if (c.revised_cells) bits.push(`${plural(c.revised_cells, "value")} revised`);
  if (c.cols_added && c.cols_added.length) bits.push(`${plural(c.cols_added.length, "variable")} added`);
  if (c.cols_removed && c.cols_removed.length) bits.push(`${plural(c.cols_removed.length, "variable")} removed`);
  return bits.join(", ") || "rebuilt, same values";
}
const getJSON = u => fetch(u).then(r => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); });
/* numbers as a person would write them */
const fmtN = (v, d = 3) => { if (v === null || v === undefined || !isFinite(v)) return "–"; const a = Math.abs(v); return a >= 1e12 ? `${+(v / 1e12).toPrecision(3)} trillion` : a >= 1e9 ? `${+(v / 1e9).toPrecision(3)} billion` : a >= 1e6 ? `${+(v / 1e6).toPrecision(3)} million` : a >= 10000 ? Math.round(v).toLocaleString("en-US") : a >= 100 ? String(+v.toFixed(1)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : String(+v.toPrecision(d)); };
const timeAgo = ms => { const m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
/* next run of a daily "minute hour * * *" schedule, in UTC */
const nextRun = (cron, from = Date.now()) => { const [mi, h] = String(cron || "23 5 * * *").split(" ").map(Number), d = new Date(from); const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, mi); return t > from ? t : t + 864e5; };

/* ---------- datasets ---------- */
function splitLine(line) {
  if (line.indexOf('"') < 0) return line.split(",");
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur); return out;
}
const dataCache = {};
/* Loads one dataset's CSV into typed columns: { n, c: { column: values }, type: { column: "num" | "str" } } */
function load(ds) {
  return dataCache[ds.id] || (dataCache[ds.id] = (async () => {
    const text = await (await fetch(ds.file)).text();
    const lines = text.split("\n"); if (!lines[lines.length - 1].trim()) lines.pop();
    const head = splitLine(lines[0].replace(/\r$/, "")), n = lines.length - 1;
    const type = {}; ds.columns.forEach(c => type[c.name] = c.type);
    ds.keys.forEach(k => type[k] = k === ds.time.col && ds.time.type === "year" ? "num" : "str");
    if (ds.entity) type[ds.entity.label_col] = "str";
    const want = head.map(h => type[h]), c = {};
    head.forEach((h, j) => { if (want[j]) c[h] = want[j] === "num" ? new Float64Array(n) : new Array(n); });
    for (let i = 0; i < n; i++) {
      const f = splitLine(lines[i + 1].replace(/\r$/, ""));
      for (let j = 0; j < head.length; j++) {
        if (want[j] === "num") c[head[j]][i] = f[j] === "" || f[j] === undefined ? NaN : +f[j];
        else if (want[j]) c[head[j]][i] = f[j] ?? "";
      }
    }
    return { n, c, type };
  })());
}

/* ---------- chip picker: a search box with a tick list; picks show as removable chips ----------
   o: { items: [{ value, label, sub, tip }], set, add, none, allText, clearText, max, onChange } */
const livePickers = new Map();
function picker(root, o) {
  livePickers.get(root.id)?.abort();
  const ac = new AbortController(), on = { signal: ac.signal }; livePickers.set(root.id, ac);
  root.innerHTML = `<div class="chips"></div><div class="combo"><input type="search" role="combobox" aria-expanded="false" aria-autocomplete="list" autocomplete="off" placeholder="${esc(o.add)}" aria-label="${esc(o.add)}"><div class="menu" role="listbox" hidden></div></div>
    <div class="pacts">${o.allText ? `<button type="button" class="link" data-a="all">${esc(o.allText)}</button>` : ""}${o.clearText ? `<button type="button" class="link" data-a="none">${esc(o.clearText)}</button>` : ""}</div>`;
  const chips = $(".chips", root), input = $("input", root), menu = $(".menu", root), by = new Map(o.items.map(i => [i.value, i]));
  o.items.forEach(i => i.q = (i.label + " " + i.value + " " + (i.sub || "")).toLowerCase());
  let act = -1, list = [], showAll = false;
  const matches = () => { const q = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean); return o.items.filter(i => q.every(w => i.q.includes(w))); };
  function drawChips() {
    const sel = [...o.set].filter(v => by.has(v));
    if (!sel.length) { chips.innerHTML = `<span class="chip ghost">${esc(o.none)}</span>`; return; }
    const lim = showAll ? sel.length : 10;
    chips.innerHTML = sel.slice(0, lim).map(v => `<span class="chip">${esc(by.get(v).label)}<button type="button" data-v="${esc(v)}" aria-label="Remove ${esc(by.get(v).label)}">×</button></span>`).join("") +
      (sel.length > lim ? `<button type="button" class="chip more" data-more="1">and ${sel.length - lim} more</button>` : "");
  }
  function drawMenu() {
    const top = menu.scrollTop; list = matches().slice(0, 400);
    menu.innerHTML = list.map((i, k) => `<div class="opt${k === act ? " act" : ""}" role="option" aria-selected="${o.set.has(i.value)}" data-v="${esc(i.value)}" title="${esc(i.tip || "")}"><span class="box"></span><span>${esc(i.label)}${i.sub ? ` <small>${esc(i.sub)}</small>` : ""}</span></div>`).join("") ||
      `<div class="opt none">Nothing matches. Try a shorter word.</div>`;
    menu.scrollTop = top;
  }
  const open = () => { if (menu.hidden) { menu.hidden = false; input.setAttribute("aria-expanded", "true"); act = -1; drawMenu(); } };
  const close = () => { menu.hidden = true; input.setAttribute("aria-expanded", "false"); };
  const toggle = v => {
    if (o.set.has(v)) o.set.delete(v);
    else { if (o.max === 1) o.set.clear(); else if (o.max && o.set.size >= o.max) return; o.set.add(v); }
    drawChips(); drawMenu(); o.onChange();
    if (o.max === 1 && o.set.has(v)) { input.value = ""; close(); input.blur(); }
  };
  input.addEventListener("focus", open, on);
  input.addEventListener("input", () => { act = -1; open(); menu.scrollTop = 0; drawMenu(); }, on);
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { open(); act = Math.max(0, Math.min(list.length - 1, act + (e.key === "ArrowDown" ? 1 : -1))); drawMenu(); $(".opt.act", menu)?.scrollIntoView({ block: "nearest" }); e.preventDefault(); }
    else if (e.key === "Enter") { const it = list[act < 0 ? 0 : act]; if (it && !menu.hidden) { toggle(it.value); if (input.value) { input.value = ""; act = -1; if (!menu.hidden) drawMenu(); } } e.preventDefault(); }
    else if (e.key === "Escape") { close(); input.blur(); }
    else if (e.key === "Backspace" && !input.value && o.set.size) { const last = [...o.set].filter(v => by.has(v)).pop(); if (last !== undefined) toggle(last); }
  }, on);
  menu.addEventListener("mousedown", e => e.preventDefault(), on);       // keep focus in the box while ticking
  menu.addEventListener("click", e => { const op = e.target.closest(".opt[data-v]"); if (op) toggle(op.dataset.v); }, on);
  root.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.v !== undefined) { o.set.delete(b.dataset.v); }
    else if (b.dataset.more) { showAll = true; drawChips(); return; }
    else if (b.dataset.a === "all") matches().forEach(i => o.set.add(i.value));
    else if (b.dataset.a === "none") { o.set.clear(); showAll = false; }
    else return;
    drawChips(); if (!menu.hidden) drawMenu(); o.onChange();
  }, on);
  document.addEventListener("mousedown", e => { if (!root.contains(e.target)) close(); }, on);
  input.addEventListener("blur", () => setTimeout(() => { if (!root.contains(document.activeElement)) close(); }, 0), on);
  drawChips();
  return { redraw: () => { drawChips(); if (!menu.hidden) drawMenu(); } };
}
