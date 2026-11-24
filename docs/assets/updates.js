/* Updates page: when the data was last checked, when the next check is due, and what each check changed. Needs core.js. */
(async () => {
  const [man, log] = await Promise.all([getJSON("data/datasets.json"), getJSON("data/changelog.json").catch(() => ({ runs: [] }))]);
  const D = man.datasets, runs = log.runs || [], last = Date.parse(man.checked || (runs[0] && runs[0].at) || Date.now());
  const local = t => new Date(t).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  function tick() {
    const next = nextRun(man.cron || log.cron), left = Math.max(0, next - Date.now()), h = Math.floor(left / 36e5), m = Math.floor(left % 36e5 / 6e4);
    $("#u-last").textContent = timeAgo(last); $("#u-last-s").textContent = `${local(last)}, your time`;
    $("#u-next").textContent = h ? `in ${h} h ${m} min` : `in ${m} min`; $("#u-next-s").textContent = `${local(next)}, your time. The check is queued by GitHub and can start a few minutes late.`;
  }
  tick(); setInterval(tick, 30000);

  /* one row per dataset */
  const body = $("#u-sets tbody");
  D.forEach(d => {
    const hits = runs.filter(r => r.changed.some(c => c.id === d.id)).length, seen = runs.filter(r => r.changed.some(c => c.id === d.id) || r.unchanged.includes(d.id)).length;
    const tr = el("tr"), name = el("td"), a = el("a", "", d.title); a.href = `#${d.id}`; a.onclick = () => { setTimeout(draw, 0); }; name.append(a);
    const hi = String(d.time.max);
    tr.append(name, el("td", "", hi.includes("T") ? local(hi) : hi), el("td", "", d.built), el("td", "", d.cadence || ""), el("td", "", seen ? `${hits} of the last ${seen} checks` : "Not checked yet"));
    body.append(tr);
  });

  /* the log */
  const box = $("#u-log"), title = id => (D.find(d => d.id === id) || { title: id }).title;
  function draw() {
    const only = decodeURIComponent(location.hash.slice(1)), known = D.some(d => d.id === only); box.replaceChildren();
    $("#u-filter").hidden = !known; if (known) $("#u-filter-text").textContent = `Showing only ${title(only)}.`;
    let shown = 0;
    runs.forEach(r => {
      const list = r.changed.filter(c => !known || c.id === only); if (known && !list.length) return; shown++;
      const card = el("article", "runcard"), h = el("h3", "", local(r.at)); h.append(el("small", "", timeAgo(Date.parse(r.at)))); card.append(h);
      if (!list.length) card.append(el("p", "same", "Every source was checked. Nothing had changed."));
      list.forEach(c => {
        const row = el("div", "chg"), left = el("div"), right = el("div"), a = el("a", "", c.title); a.href = `datasets.html#${c.id}`; const b = el("b"); b.append(a); left.append(b);
        const line = changeLine(c); right.append(el("p", "", line.charAt(0).toUpperCase() + line.slice(1) + "."));
        if (c.latest_to) right.append(el("p", "", `Newest entry moved from ${String(c.latest_from).replace("T", " ").replace("Z", " UTC")} to ${String(c.latest_to).replace("T", " ").replace("Z", " UTC")}.`));
        if (c.cols_added && c.cols_added.length) right.append(el("p", "", `New: ${c.cols_added.slice(0, 12).join(", ")}${c.cols_added.length > 12 ? " and more" : ""}.`));
        if (c.top && c.top.length) right.append(el("p", "", `Most revised: ${c.top.map(([t, n]) => `${t} (${n.toLocaleString("en-US")})`).join(", ")}.`));
        if (c.examples && c.examples.length) { const ul = el("ul"); c.examples.forEach(x => { const li = el("li"); li.append(el("span", "", `${x.where}, ${x.what}: `)); if (x.old !== undefined) { li.append(el("del", "", x.old || "empty"), document.createTextNode(" became "), el("ins", "", x.new || "empty")); } else li.append(el("ins", "", x.new), document.createTextNode(" (new row)")); ul.append(li); }); right.append(ul); }
        row.append(left, right); card.append(row);
      });
      if (!known && r.unchanged.length && list.length) card.append(el("p", "same", `Checked, no change: ${r.unchanged.map(title).join(", ")}.`));
      if (r.failed && r.failed.length) card.append(el("p", "same", `${plural(r.failed.length, "source")} could not be reached in this check; the last good copy was kept.`));
      box.append(card);
    });
    if (!shown) box.append(el("p", "note", known ? `${title(only)} has not changed in the ${plural(runs.length, "check")} on record.` : "No checks are on record yet."));
  }
  $("#u-clear").onclick = () => { history.replaceState(null, "", "updates.html"); draw(); };
  addEventListener("hashchange", draw); draw();
  $("#u-count").textContent = `${plural(runs.length, "check")} on record. The log keeps the most recent 120.`;
})().catch(e => { console.error(e); $("#u-log").append(el("p", "note", "The update log could not be loaded. Reload to try again.")); });
