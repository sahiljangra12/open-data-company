/* The chat app around Data AI (ask.html): saved chats in a side panel, and the choice of who answers.

   The answering itself is ask.js. This file adds what a chat product has around it:
   - Each chat is saved in this browser (localStorage) as the conversation as it looked, plus the short memory the model
     keeps, so it can be opened again and carried on. Nothing is sent to a server. When the browser's space runs out the
     oldest chats are dropped first.
   - The on-device model (brain-local.js) is downloaded, switched on and off, and removed from here.

   Needs core.js, ask.js (AI, last, busy, respond) and brain-local.js (LOCAL). */
(() => {
  const KEY = "odc.chats.v1", SET = "odc.brain.v1", MAX = 40;
  const thread = $("#thread"), list = $("#chatlist"), side = $("#side");
  const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v === null || v === undefined ? d : v; } catch (e) { return d; } };
  let chats = get(KEY, []), current = null, armed = null;
  if (!Array.isArray(chats)) chats = [];
  chats = chats.filter(c => c && typeof c.id === "string" && typeof c.html === "string");

  /* ---------- saving ---------- */
  function store() {                                                    // write the chats; when the browser is full, let the oldest go, then the charts of the open one
    for (let tries = 0; tries < MAX + 2; tries++) {
      try { localStorage.setItem(KEY, JSON.stringify(chats)); return true; }
      catch (e) {
        const old = [...chats].reverse().find(c => c.id !== current);
        if (old) chats = chats.filter(c => c !== old);
        else if (chats[0] && !chats[0].slim) { const t = document.createElement("template"); t.innerHTML = chats[0].html; $$(".vizzes", t.content).forEach(v => v.replaceChildren(el("p", "ainote", "The charts of this chat were too large to keep. Ask again to draw them."))); chats[0].html = t.innerHTML; chats[0].slim = true; }
        else return false;
      }
    }
    return false;
  }
  function snapshot() {                                                 // the turns as they look now, without the parts that only work while live
    const box = document.createElement("div");
    $$(".turn", thread).forEach(t => { const c = t.cloneNode(true); $$(".thinking", c).forEach(x => x.remove()); c.classList.add("saved"); box.append(c); });
    return box.innerHTML;
  }
  /* Saved HTML is the page's own earlier output, but it has been sitting in storage, so it is cleaned before it is shown:
     nothing that can run or load, and no link that is not an ordinary one. */
  function clean(html) {
    const t = document.createElement("template"); t.innerHTML = html;
    $$("script,iframe,object,embed,link,style,meta,base,form,foreignObject,use,image,img,video,audio,source", t.content).forEach(n => n.remove());
    $$("*", t.content).forEach(n => { [...n.attributes].forEach(a => { const name = a.name.toLowerCase(), v = a.value.trim().toLowerCase(); if (name.startsWith("on") || name === "srcdoc" || name === "style" && /url\(|expression/.test(v) || ((name === "href" || name === "xlink:href" || name === "src" || name === "action") && /^(javascript|data|vbscript):/.test(v))) n.removeAttribute(a.name); }); });
    return t.content;
  }
  function save(q) {
    const html = snapshot(); if (!html) return;
    let c = chats.find(x => x.id === current);
    if (!c) { c = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), title: q.length > 64 ? q.slice(0, 61).trimEnd() + "…" : q }; current = c.id; }
    Object.assign(c, { html, at: Date.now(), memory: AI.memory, last: { v: last.v, places: last.places, ai: last.ai }, slim: false });
    chats = [c, ...chats.filter(x => x !== c)].slice(0, MAX);
    if (!store()) note("This browser has no room left to save chats. Earlier chats are still listed; this one may not be kept.");
    draw();
  }

  /* ---------- the list ---------- */
  const when = t => { const d = new Date(t), now = new Date(), days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    return days <= 0 ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : days === 1 ? "Yesterday" : days < 7 ? d.toLocaleDateString([], { weekday: "long" }) : d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" }); };
  function draw() {
    list.replaceChildren();
    chats.forEach(c => {
      const li = el("li"), open = el("button", "open"), on = c.id === current; open.type = "button"; open.append(el("span", "t", c.title), el("span", "w", when(c.at)));
      if (on) { li.className = "on"; open.setAttribute("aria-current", "true"); }
      open.onclick = () => show(c.id);
      li.append(open);
      if (on) {
        const row = el("p", "row"), rn = el("button", "link", "Rename"), del = el("button", "link", armed === c.id ? "Delete for good?" : "Delete"); rn.type = del.type = "button";
        rn.onclick = () => rename(c, li);
        del.onclick = () => { if (armed !== c.id) { armed = c.id; draw(); $(".chatlist li.on .row .link:last-child").focus(); return; } armed = null; chats = chats.filter(x => x !== c); store(); fresh(); };   // asks once more on the button itself, no pop-up
        row.append(rn, del); li.append(row);
      }
      list.append(li);
    });
    $("#nochats").hidden = chats.length > 0; $("#clear-chats").hidden = chats.length < 2; $("#clear-chats").textContent = armed === "all" ? "Delete every chat for good?" : "Delete all chats";
  }
  function rename(c, li) {
    const f = el("form", "rename"), inp = el("input"), ok = el("button", "link", "Save"); inp.value = c.title; inp.maxLength = 80; inp.setAttribute("aria-label", "Name of this chat"); ok.type = "submit";
    f.append(inp, ok); f.onsubmit = e => { e.preventDefault(); const t = inp.value.trim(); if (t) { c.title = t; store(); } draw(); };
    inp.onkeydown = e => { if (e.key === "Escape") draw(); };
    li.replaceChildren(f); inp.focus(); inp.select();
  }
  function note(text) { const p = el("p", "ainote", text); thread.append(p); thread.scrollTop = thread.scrollHeight; }
  function fresh() { armed = null; $("#fresh-chat").click(); }                                // ask.js clears the conversation and its memory, then says "dataai:fresh"
  function show(id) {
    if (busy) return;                                                   // an answer is being written: let it finish first
    const c = chats.find(x => x.id === id); if (!c) return;
    if (id === current) { closeSide(); return; }
    fresh(); current = id; armed = null;
    const head = el("p", "ainote savednote", `Saved chat from ${new Date(c.at).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })}. The charts are pictures of what was drawn then. Carry on below.`);
    thread.append(head, clean(c.html));
    AI.memory = Array.isArray(c.memory) ? c.memory.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-6) : [];
    if (c.last) { last.v = typeof c.last.v === "string" && V.has(c.last.v) ? c.last.v : null; last.places = Array.isArray(c.last.places) ? c.last.places.filter(x => typeof x === "string") : []; last.ai = !!c.last.ai; }
    $("#fresh-chat").hidden = false; thread.scrollTop = thread.scrollHeight; draw(); closeSide(); $("#q").focus({ preventScroll: true });
  }
  document.addEventListener("dataai:turn", e => save(e.detail.q));
  document.addEventListener("dataai:fresh", () => { current = null; $$(".savednote", thread).forEach(n => n.remove()); draw(); });
  $("#new-chat").onclick = () => { if (busy) return; fresh(); closeSide(); };
  $("#clear-chats").onclick = () => { if (armed !== "all") { armed = "all"; draw(); return; } chats = []; store(); fresh(); };
  /* follow-up questions under a saved answer still work: they are asked again */
  thread.addEventListener("click", e => { const b = e.target.closest(".turn.saved .nextq button, .turn.saved .quick button"); if (b) respond(b.textContent); });

  /* ---------- the side panel on a narrow screen ---------- */
  const toggle = $("#side-toggle");
  function closeSide() { side.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); }
  toggle.onclick = () => { const open = side.classList.toggle("open"); toggle.setAttribute("aria-expanded", open); if (open) $("#new-chat").focus(); };
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeSide(); });
  document.addEventListener("click", e => { if (side.classList.contains("open") && !e.target.closest("#side, #side-toggle")) closeSide(); });

  /* ---------- who answers ---------- */
  const set = Object.assign({ prefer: "auto", model: LOCAL.MODELS[0].id, on: false, had: false }, get(SET, {}));   // had: a model was downloaded here before
  if (!LOCAL.MODELS.some(m => m.id === set.model)) set.model = LOCAL.MODELS[0].id;
  if (set.prefer !== "local") set.prefer = "auto";
  const keep = () => { try { localStorage.setItem(SET, JSON.stringify(set)); } catch (e) { /* private mode: the choice lasts for this page only */ } };
  const sel = $("#model"), go = $("#device-go"), off = $("#device-off"), rm = $("#device-remove"), bar = $("#bar"), dnote = $("#device-note"), mnote = $("#model-note");
  LOCAL.MODELS.forEach(m => { const o = el("option", "", `${m.name} (${m.size})`); o.value = m.id; sel.append(o); }); sel.value = set.model;
  const model = () => LOCAL.MODELS.find(m => m.id === sel.value);
  let has = false, hostedOn = false;
  AI.prefer = set.prefer; $$('input[name="prefer"]').forEach(r => { r.checked = r.value === set.prefer; r.onchange = () => { if (!r.checked) return; set.prefer = AI.prefer = r.value; keep(); panel(); }; });
  AI.badge = (on, b) => {                                              // the line under "Data AI" at the top of the chat
    hostedOn = on; const loc = LOCAL.ready(), only = AI.prefer === "local";
    b.textContent = LOCAL.S.loading ? "Getting the on-device model ready." : only && loc ? "The on-device model answers. Questions for the AI stay on this device." : only ? "Answering straight from the datasets. Turn on the on-device model for AI answers."
      : on ? "AI answers are on. Figures come from the datasets." + (loc ? " The on-device model is standing by." : "") : loc ? "The hosted AI is resting, so the on-device model answers." : "Answering straight from the datasets. The AI part is resting.";
    b.classList.toggle("on", only ? loc : on || loc);
  };
  const badge = () => AI.badge(hostedOn, $("#ai-state"));
  const WHY = { nogpu: "This browser cannot run a model on the device. It needs WebGPU, which recent versions of Chrome, Edge and Safari have.", space: "The browser did not have room to store the model. Free some space and try again.", memory: "This device's graphics memory was not enough for that model. Try the smaller one.", failed: "The model could not be loaded. Check the connection and try again." };
  async function panel() {
    const m = model(), ok = LOCAL.supported() || !!window.WEBLLM_STAND_IN, loading = !!LOCAL.S.loading, ready = LOCAL.ready(), mine = ready && LOCAL.S.model === m.id;
    mnote.textContent = `${m.note} Licence: ${m.licence}. Needs ${m.memory}.`;
    sel.disabled = loading; go.hidden = mine; go.disabled = loading || !ok; off.hidden = !ready || loading; rm.hidden = !has || loading; bar.hidden = !loading;
    go.textContent = loading ? "Getting it ready" : ready ? `Switch to ${m.name}` : has ? "Turn on" : `Download and turn on (${m.size})`;
    dnote.textContent = !ok ? WHY.nogpu : loading ? dnote.textContent : LOCAL.S.error ? WHY[LOCAL.S.error] : ready ? `On: ${(LOCAL.MODELS.find(x => x.id === LOCAL.S.model) || m).name}. It runs in this tab and uses this device's graphics chip.`
      : has ? "Downloaded and kept in this browser. Turn it on to use it." : "Off. Turning it on downloads the model once from Hugging Face and keeps it in this browser. After that it works without the hosted AI.";
    badge();
  }
  async function turnOn() {
    set.model = sel.value; set.on = true; keep();
    const run = LOCAL.load(sel.value, r => { const pct = Math.round((r.progress || 0) * 100); bar.firstChild.style.width = pct + "%"; dnote.textContent = /cache/i.test(r.text || "") && !/fetch/i.test(r.text || "") ? `Loading the model into memory: ${pct}%` : `Downloading and loading the model: ${pct}%. This happens once.`; });
    bar.firstChild.style.width = "0%"; dnote.textContent = "Starting."; panel();
    const ok = await run; set.on = ok; if (ok) set.had = true; keep();
    has = ok || (set.had && await LOCAL.cached(sel.value)); panel();
  }
  go.onclick = turnOn;
  off.onclick = async () => { set.on = false; keep(); await LOCAL.unload(); panel(); };
  rm.onclick = async () => { set.on = false; keep(); rm.disabled = true; await LOCAL.remove(sel.value); rm.disabled = false; has = await LOCAL.cached(sel.value); panel(); };   // the 6 MB library is only fetched once a model has been asked for
  sel.onchange = async () => { has = set.had && await LOCAL.cached(sel.value); panel(); };

  draw();
  (async () => { has = set.had && await LOCAL.cached(set.model); await panel(); if (set.on && has && (LOCAL.supported() || window.WEBLLM_STAND_IN)) turnOn(); })();   // it was on last time and is already downloaded: bring it back
})();
