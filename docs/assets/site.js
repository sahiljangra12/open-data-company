const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const COMM = { yes: "Commercial use OK", check: "Check terms", restricted: "Restricted" };
const fmt = n => Number(n).toLocaleString("en-US");
const sign = n => (n > 0 ? "+" : "") + n.toFixed(1) + "%";

async function catalog() {
  const d = await (await fetch("data/catalog.json")).json();
  const S = d.sources, sel = id => $("#" + id);
  const fill = (id, vals) => vals.forEach(v => sel(id).insertAdjacentHTML("beforeend", `<option>${esc(v)}</option>`));
  fill("f-domain", [...new Set(S.map(s => s.domain))].sort());
  const order = ["realtime", "daily", "weekly", "monthly", "quarterly", "annual", "varies"];
  fill("f-update", order);
  function draw() {
    const q = sel("q").value.trim().toLowerCase(), r = sel("f-region").value, dm = sel("f-domain").value,
      c = sel("f-comm").value, u = sel("f-update").value, api = sel("f-api").checked;
    const rows = S.filter(s => (!q || (s.name + " " + s.domain + " " + s.buyers + " " + s.licence).toLowerCase().includes(q)) &&
      (!r || s.region === r) && (!dm || s.domain === dm) && (!c || s.commercial === c) && (!u || s.update === u) && (!api || s.api));
    $("#count").textContent = `${rows.length} of ${S.length} sources`;
    $("#rows").innerHTML = rows.map(s => `<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></td>
      <td>${esc(s.region)}</td><td>${esc(s.domain)}</td><td>${esc(s.update)}</td><td>${s.api ? "Yes" : "No"}</td>
      <td><span class="tag ${s.commercial}">${COMM[s.commercial]}</span><br><small>${esc(s.licence)}</small></td><td>${esc(s.buyers)}</td></tr>`).join("") ||
      `<tr><td colspan="7">No sources match these filters.</td></tr>`;
  }
  ["q", "f-region", "f-domain", "f-comm", "f-update", "f-api"].forEach(id => sel(id).addEventListener("input", draw));
  draw();
}

async function scorecard() {
  const d = await (await fetch("data/scorecard.json")).json();
  $("#s-mae").textContent = d.mean_abs_error_pct.toFixed(1) + "%";
  $("#s-over").textContent = `${d.n_over} of ${d.n_zones}`;
  const rto = d.zones.find(z => z.zone === "PJM RTO");
  $("#s-rto").textContent = sign(rto.error_pct);
  const down = d.zones.filter(z => !z.region && z.outlook_revision_pct < 0).length;
  $("#s-rev").textContent = `${down} of ${d.n_zones}`;
  document.querySelectorAll(".yr").forEach(e => e.textContent = d.target_year);
  document.querySelectorAll(".oy").forEach(e => e.textContent = rto.outlook_year);
  $("#src").textContent = `Forecast: ${d.forecast_vintage}. Actuals and revised outlook: ${d.actual_source}.`;
  const max = Math.max(...d.zones.map(z => Math.abs(z.error_pct)));
  let key = "abs", dir = -1;
  const val = z => key === "abs" ? Math.abs(z.error_pct) : key === "zone" ? z.zone : z[key];
  function draw() {
    const zs = d.zones.filter(z => !z.region).sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
    const row = z => {
      const w = Math.abs(z.error_pct) / max * 50;
      return `<tr class="${z.region ? "region" : ""}"><td>${esc(z.zone)}</td><td class="num">${fmt(z.forecast_mw)}</td>
        <td class="num">${fmt(z.normalized_mw)}</td><td class="num">${fmt(z.metered_mw)}</td><td class="num">${sign(z.error_pct)}</td>
        <td><div class="bar" title="${sign(z.error_pct)}"><i class="${z.error_pct >= 0 ? "over" : "under"}" style="width:${w}%"></i></div></td>
        <td class="num">${sign(z.outlook_revision_pct)}</td></tr>`;
    };
    $("#rows").innerHTML = zs.map(row).join("") + d.zones.filter(z => z.region).map(row).join("");
  }
  document.querySelectorAll("th.sort").forEach(th => th.addEventListener("click", () => {
    const k = th.dataset.k; dir = k === key ? -dir : (k === "zone" ? 1 : -1); key = k; draw();
  }));
  draw();
}

({ catalog, scorecard })[document.body.dataset.page]?.().catch(e => { console.error(e); const m = $("#rows") || $("main"); m.insertAdjacentHTML("beforeend", "<p>Data failed to load.</p>"); });
