/* The on-device brain for Data AI (chat page): a small open language model that runs inside the visitor's browser.

   WebLLM (vendor/web-llm.js, Apache 2.0) runs the model on the device's graphics chip through WebGPU. The model file is
   downloaded once from Hugging Face, kept in the browser's cache and never sent anywhere: questions answered by this brain
   do not leave the device. No key, no service, no cost.

   A model this small cannot be trusted with numbers, so it works under the same rules as the site's GitHub agent:
   - It reads data only through the page's own tools (TOOLS in ask.js), asked for with one line: CALL {"tool": ..., "args": ...}
   - Every figure in its answer is matched against what those tools returned. Unmatched figures go back to the model to
     correct, twice at most; an answer that still fails is dropped and the page answers straight from the data instead.

   Needs ask.js (AI, TOOLS, TOOL_SAYS, hintFor, nextFor, parse). Sets AI.local. */
const LOCAL = (() => {
  const MODELS = [
    { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", name: "Qwen2.5 1.5B", licence: "Apache 2.0", size: "about 1 GB", memory: "about 2 GB of graphics memory", note: "Quick. Fine for reading figures and short answers." },
    { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", name: "Phi-3.5 mini", licence: "MIT", size: "about 2.2 GB", memory: "about 4 GB of graphics memory", note: "Slower to download and to answer, steadier with longer questions." },
  ];
  const SYSTEM = `You are Data AI, the assistant of Open Data Company, a website of open datasets. You run on the visitor's own device.

To read data, reply with one line and nothing else:
CALL {"tool":"NAME","args":{...}}
You will then get a line starting with RESULT. Tools:
- find_variables {"query":"plain words"} : search for variable ids. An id looks like dataset::column
- get_values {"variable":"id","places":["India","United States"],"year":2020} : the value for named places. Leave year out for the newest
- rank {"variable":"id","order":"top","n":5} : countries ranked. order is "top" or "bottom"
- get_series {"variable":"id","place":"India","from":1990,"to":2024} : change over time. Leave place out for a world series such as an oil price
- show_chart {"kind":"line","variable":"id","places":["India"],"from":1990} : draws a chart in the chat. kind is "line", "bar" or "map". It returns the key figures

Rules:
- For any statistic, CALL a tool first. Never give a figure from memory.
- The question may end with a note from the site listing variable ids that fit. Use those ids exactly.
- If the question names a country, read that country's value with get_values.
- Copy each figure exactly from RESULT, with its unit and year, and name the source.
- When the person asks for a chart, graph, plot or map, CALL show_chart.
- When you have the values, write the answer: the direct answer first, under 100 words, plain text. Put ** around key numbers. No headings.
- If the tools have nothing on the topic, answer in two or three sentences starting with "From general knowledge, not this site's data:".`;

  const S = { engine: null, model: null, loading: null, progress: null, error: "" };
  const stoppedErr = () => Object.assign(new Error("Stopped by the visitor"), { reason: "stopped" });
  const supported = () => typeof navigator !== "undefined" && !!navigator.gpu;
  const ready = () => !!S.engine;

  /* ---------- the model ---------- */
  async function load(modelId, onProgress) {
    if (S.engine && S.model === modelId) return true;
    if (S.loading) return S.loading;
    S.error = "";
    S.loading = (async () => {
      try {
        if (!supported() && !window.WEBLLM_STAND_IN) throw Object.assign(new Error("This browser has no WebGPU"), { reason: "nogpu" });
        const lib = window.WEBLLM_STAND_IN || await import("../vendor/web-llm.js");                    // the test suite puts a scripted stand-in here
        if (S.engine) { try { await S.engine.unload(); } catch (e) { /* the old model is dropped either way */ } S.engine = null; }
        const engine = await lib.CreateMLCEngine(modelId, { initProgressCallback: r => { S.progress = r; if (onProgress) onProgress(r); } });
        S.engine = engine; S.model = modelId; return true;
      } catch (e) { console.warn("on-device model not loaded", e); S.error = e.reason === "nogpu" ? "nogpu" : /quota|storage/i.test(String(e && e.message)) ? "space" : /memory|device lost|adapter/i.test(String(e && e.message)) ? "memory" : "failed"; S.engine = null; S.model = null; return false; }
      finally { S.loading = null; S.progress = null; }
    })();
    return S.loading;
  }
  async function unload() { const e = S.engine; S.engine = null; S.model = null; if (e) { try { await e.unload(); } catch (x) { /* gone either way */ } } }
  async function cached(modelId) { try { if (window.WEBLLM_STAND_IN) return !!window.WEBLLM_STAND_IN.cached; const lib = await import("../vendor/web-llm.js"); return await lib.hasModelInCache(modelId); } catch (e) { return false; } }
  async function remove(modelId) { await unload(); try { const lib = window.WEBLLM_STAND_IN || await import("../vendor/web-llm.js"); if (lib.deleteModelAllInfoInCache) await lib.deleteModelAllInfoInCache(modelId); return true; } catch (e) { console.warn(e); return false; } }

  async function generate(messages, signal, onText) {
    let out = "";
    const stream = await S.engine.chat.completions.create({ messages, stream: true, temperature: 0, max_tokens: 420 });
    for await (const chunk of stream) {
      if (signal.aborted) break;
      const piece = (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) || "";
      if (piece) { out += piece; if (onText) onText(out); }
    }
    if (signal.aborted) throw stoppedErr();
    return out.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  }

  /* ---------- reading the model's reply ---------- */
  const mayBeCall = t => { const s = t.trimStart(); return s.length < 6 || /^(CALL\b|`{0,3}\s*(json)?\s*\{|\{)/i.test(s); };
  /* A tool request: CALL {...}, or the bare JSON a small model sometimes writes instead. Returns { tool, args } or null. */
  function parseCall(text) {
    const s = text.trim(); if (!/^(CALL\b|`{0,3}\s*(json)?\s*\{|\{)/i.test(s)) return null;
    const a = s.indexOf("{"); if (a < 0) return null;
    let depth = 0, inStr = false, end = -1;
    for (let i = a; i < s.length; i++) { const ch = s[i]; if (inStr) { if (ch === "\\") i++; else if (ch === '"') inStr = false; continue; } if (ch === '"') inStr = true; else if (ch === "{") depth++; else if (ch === "}" && --depth === 0) { end = i; break; } }
    if (end < 0) return null;
    try { const o = JSON.parse(s.slice(a, end + 1)), tool = o.tool || o.name || o.function, args = o.args || o.arguments || o.parameters || {}; return typeof tool === "string" && args && typeof args === "object" ? { tool, args } : null; } catch (e) { return null; }
  }

  /* ---------- the figure check (the same rule as agent/run.py) ---------- */
  function numbers(text) {                                              // every number written in a text, as [value, decimals]; dates, times and list numbering are left out
    let t = String(text).replace(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?|\b\d{1,2}:\d{2}(:\d{2})?\b|https?:\/\/\S+/g, " ");
    t = t.replace(/\b\d{1,2}(st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/g, " ").replace(/^\s*\d+[.)]\s/gm, " ");
    const out = []; for (const m of t.matchAll(/(?<![\w.])-?\d[\d,]*(?:\.\d+)?(?![\w])/g)) { const raw = m[0].replace(/,/g, "").replace(/^-/, ""), x = parseFloat(raw); if (isFinite(x)) out.push([x, raw.includes(".") ? raw.split(".")[1].length : 0]); }
    return out;
  }
  const plain = ([x, dec]) => dec === 0 && (x <= 12 || (x >= 1800 && x <= 2100));                    // a year or a small count is not a statistic
  /* Figures in a text that match nothing in the evidence. A figure matches when some number read rounds to it, as written
     or scaled to thousands, millions, billions, trillions or percent. */
  function ungrounded(text, evidence) {
    const seen = [...new Set(numbers(evidence).map(n => n[0]))], bad = [];
    for (const n of numbers(text)) {
      if (plain(n)) continue; const [x, dec] = n, tol = 0.5 * Math.pow(10, -dec) + 1e-9;
      if (!seen.some(e => [1, 1e3, 1e6, 1e9, 1e12, 0.01].some(k => Math.abs(e / k - x) <= tol))) bad.push(String(x));
    }
    return [...new Set(bad)];
  }
  /* What is wrong with a draft, as a message for the model, or "" when it may be shown. */
  function check(text, question, hint, reads) {
    const figures = numbers(text).filter(n => !plain(n));
    if (!reads.length) return figures.length && /Variables that may fit/.test(hint) ? "You gave figures without reading any data. Do not answer from memory. Reply with one CALL line now, using a variable id from the note under the question." : "";
    const loose = ungrounded(text, question + " " + reads.join(" "));
    return loose.length ? `These figures in your answer match nothing in the RESULT lines: ${loose.join(", ")}. Write the whole answer again. Copy each figure digit by digit from RESULT, or leave out what you cannot support. Reply with the corrected answer only.` : "";
  }

  /* ---------- one answer ---------- */
  async function turn(question, say, box, live) {
    if (!S.engine) throw Object.assign(new Error("The on-device model is not loaded"), { reason: "error" });
    const stop = AI.stop = new AbortController(); stop.signal.addEventListener("abort", () => { try { S.engine.interruptGenerate(); } catch (e) { /* nothing was being written */ } });
    const hint = hintFor(question), used = [], reads = []; used.box = box;
    const messages = [{ role: "system", content: SYSTEM }, ...AI.memory.slice(-4), { role: "user", content: question + hint }];
    const fit = () => { let n = messages.reduce((a, m) => a + m.content.length, 0); for (let i = 2; n > 9000 && i < messages.length - 2; i++) { const m = messages[i]; if (m.role === "user" && m.content.startsWith("RESULT") && m.content.length > 260) { n -= m.content.length - 260; m.content = m.content.slice(0, 260) + " …(shortened)"; } } };   // the model reads about 4,000 tokens at most
    let fixes = 2, calls = 0, rounds = 0, text = "";
    say("Thinking on this device");
    for (let step = 0; step < 9; step++) {
      if (stop.signal.aborted) throw stoppedErr();
      fit(); rounds++;
      let streaming = false;
      const out = await generate(messages, stop.signal, t => { if (!streaming && !mayBeCall(t)) streaming = true; if (streaming && live) live(t); });
      const call = parseCall(out);
      if (call) {
        if (live) live("");
        if (++calls > 5) { messages.push({ role: "assistant", content: out.slice(0, 300) }, { role: "user", content: "No more CALL lines. Write the answer now from the RESULT lines above." }); continue; }
        say((TOOL_SAYS[call.tool] || (() => "Reading the data"))(call.args) + ".");
        let res; try { res = TOOLS[call.tool] && call.tool !== "get_rows" ? await TOOLS[call.tool](call.args, used) : { error: "No such tool. The tools are find_variables, get_values, rank, get_series and show_chart." }; } catch (e) { console.warn(e); res = { error: "The data could not be read just now." }; }
        const json = JSON.stringify(res); if (!res.error && call.tool !== "find_variables") reads.push(json);
        messages.push({ role: "assistant", content: `CALL ${JSON.stringify(call)}` }, { role: "user", content: `RESULT ${json.slice(0, 1800)}\n${call.tool === "find_variables" ? "These are ids only, not values. CALL get_values, rank, get_series or show_chart with one of them." : "If this is all you need, write the answer now. Otherwise send one more CALL line."}` });
        continue;
      }
      text = out.replace(/^```\w*|```$/g, "").trim(); if (!text) throw Object.assign(new Error("Empty answer"), { reason: "error" });
      const wrong = check(text, question, hint, reads); if (!wrong) break;
      if (fixes-- <= 0) throw Object.assign(new Error("Figures not matched to the data read"), { reason: "check" });
      if (live) live(""); say("Checking the figures against the data"); messages.push({ role: "assistant", content: text }, { role: "user", content: wrong }); text = "";
    }
    if (!text) throw Object.assign(new Error("No answer in the steps allowed"), { reason: "error" });
    let next = []; try { next = nextFor(question, parse(question)); } catch (e) { /* no follow-ups this time */ }
    AI.memory = [...AI.memory, { role: "user", content: question }, { role: "assistant", content: text }].slice(-6);
    return { text, used, cost: { usd: 0, rounds, cached: 0 }, next };
  }

  const api = { MODELS, S, supported, ready, load, unload, cached, remove, turn, check, ungrounded, numbers, parseCall };
  AI.local = api;
  return api;
})();
