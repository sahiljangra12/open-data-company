// Local stand-ins for testing the page end to end: a scripted "model" (port 8768) and the real Data AI function (port 8767).
// Started by tests/browser/run.sh. No real model is called and nothing is spent.
import http from "node:http";
import fs from "node:fs";
import { sse } from "../sse.mjs";
const FUNCTION = new URL("../../ai/netlify/functions/data-ai.mts", import.meta.url).href;
const log = [];
const model = http.createServer((req, res) => {
  if (req.method === "GET" && req.url.startsWith("/datasets.json")) { res.setHeader("content-type", "application/json"); return res.end(fs.readFileSync(new URL("../../docs/data/datasets.json", import.meta.url))); }   // the site's own list of datasets
  let body = ""; req.on("data", c => body += c); req.on("end", () => {
    const j = JSON.parse(body || "{}"), msgs = j.messages, first = [...msgs].reverse().find(m => typeof m.content === "string" && m.role === "user").content.toLowerCase();
    const results = msgs.filter(m => Array.isArray(m.content)).flatMap(m => m.content).filter(b => b.type === "tool_result");
    log.push({ n: msgs.length, first, results: results.length, lastResult: results.length ? String(results[results.length - 1].content).slice(0, 5200) : "", hasMemory: msgs.length > 1 && typeof msgs[0].content === "string" && msgs[0].content.toLowerCase() !== first, stream: !!j.stream, tools: (j.tools || []).map(t => t.name), system: JSON.stringify(j.system || "").length, knowsRents: JSON.stringify(j.system || "").includes("us-states-rents") });
    res.setHeader("content-type", "application/json");
    const send = (content, stop) => { const m = { id: "msg_x", type: "message", role: "assistant", model: j.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 2600, output_tokens: 120 } };
      return j.stream ? sse(res, m, first.includes("slowly") ? { pieces: 8, pause: 120 } : { pieces: 3 }) : res.end(JSON.stringify(m)); };
    const use = (name, input, id = "toolu_" + Math.random().toString(36).slice(2, 8)) => ({ type: "tool_use", id, name, input });
    if (first.includes("boom")) { res.statusCode = 500; return res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } })); }
    if (first.includes("hamlet")) return send([{ type: "text", text: "From general knowledge, not this site's data: **William Shakespeare** wrote Hamlet, around 1600." }], "end_turn");
    if (first.includes("script")) return send([{ type: "text", text: "Here is markup that must stay text: <img src=x onerror=\"window.__pwned=1\"> and <script>window.__pwned=2</script>\n\n- first **point**\n- second point" }], "end_turn");
    if (first.includes("loop")) return send([use("find_variables", { query: "population" })], "tool_use");
    if (first.includes("slowly")) return send([{ type: "text", text: "From general knowledge, not this site's data: an answer that arrives a little at a time, so the page can show it while it is still being written. It has **two** sentences.\n\n>> What is India's life expectancy? | Top 5 CO2 emitters" }], "end_turn");
    if (first.includes("small table")) return send([{ type: "text", text: "Here are the two side by side.\n\n| Country | Life expectancy | Income |\n|---|---|---|\n| **India** | 72.0 | 2,480 |\n| China | 78.0 | 12,600 |\n\nChina is ahead on both.\n\n>> How has India changed since 2000? | Which countries rank highest?" }], "end_turn");
    if (results.length) {
      const last = JSON.parse(results[results.length - 1].content);
      if (last.table) { const r = last.rows[0], col = Object.keys(last.columns)[0]; return send([{ type: "text", text: `From ${last.table}: **${r.name}** has ${last.columns[col].toLowerCase()} of **${r[col]}**${r.year ? " in " + r.year : ""} (${last.source}). ${last.rows_matching} rows matched.\n\n>> Which state has the highest rent? | How has it changed since 2021? | Show the cheapest five` }], "end_turn"); }
      if (last.error && first.includes("badchart")) return send([{ type: "text", text: "I could not draw that one: " + last.error }], "end_turn");
      if (last.error && results.length === 1) return send([use("find_variables", { query: "life expectancy" })], "tool_use");
      if (last.matches) return send([use("get_values", { variable: last.matches[0].id, places: ["India"] })], "tool_use");
      if (last.drawn) return send([{ type: "text", text: `Here is the ${last.drawn}: **${last.title}**. ${last.series ? last.series[0].place + " ended at " + last.series[0].last.value + "." : last.rows ? last.rows[0].place + " leads." : last.correlation !== undefined ? "The correlation is " + last.correlation + "." : "The highest is " + last.highest[0].place + "."}` }], "end_turn");
      if (last.error && first.includes("badchart")) return send([{ type: "text", text: "I could not draw that one: " + last.error }], "end_turn");
      if (last.values) { const v = last.values[0]; return send([{ type: "text", text: `${v.place}'s ${last.variable.toLowerCase()} was **${v.value} ${last.unit}** in ${v.year} (${last.source}).\n\nFrom general knowledge, not this site's data: better health care and nutrition are the usual reasons.` }], "end_turn"); }
      if (last.rows) return send([{ type: "text", text: `The leaders are:\n\n- **${last.rows[0].place}**: ${last.rows[0].value}\n- **${last.rows[1].place}**: ${last.rows[1].value}\n- **${last.rows[2].place}**: ${last.rows[2].value}` }], "end_turn");
      if (last.points) return send([{ type: "text", text: `It went from **${last.first.value}** (${last.first.when}) to **${last.last.value}** (${last.last.when}); the peak was ${last.highest.value} in ${last.highest.when}.` }], "end_turn");
      if (last.past_24_hours) return send([{ type: "text", text: `There were **${last.past_24_hours.count}** earthquakes in the past 24 hours.` }], "end_turn");
      return send([{ type: "text", text: "I read the data: " + JSON.stringify(last).slice(0, 200) }], "end_turn");
    }
    if (first.includes("badchart")) return send([use("show_chart", { kind: "line", variable: "nope::nothing", places: ["India"] })], "tool_use");
    if (first.includes("rent in texas")) return send([use("get_rows", { dataset: "us-states-rents", find: "Texas" })], "tool_use");
    if (first.includes("dearest colleges")) return send([use("get_rows", { dataset: "us-colleges", sort_by: "tuition_out_of_state", order: "top", n: 5 })], "tool_use");
    if (first.includes("banks that failed")) return send([use("get_rows", { dataset: "us-bank-failures-list", n: 4 })], "tool_use");
    if (first.includes("protein in lentils")) return send([use("get_rows", { dataset: "food-nutrients", find: "lentils", columns: ["protein", "calories"] })], "tool_use");
    if (first.includes("wrong table")) return send([use("get_rows", { dataset: "world-bank-development", find: "India" })], "tool_use");
    if (first.includes("sunshine")) return send([{ type: "text", text: "Let me draw that." }, use("show_chart", { kind: "line", variable: "energy::solar_share_elec", places: ["China", "India"], from: 2010 })], "tool_use");
    if (first.includes("atlas")) return send([use("show_chart", { kind: "map", variable: "world-bank-development::internet_users" })], "tool_use");
    if (first.includes("cloud of dots")) return send([use("show_chart", { kind: "scatter", variable: "world-bank-development::life_expectancy", variable_x: "world-bank-development::gdp_per_capita", places: ["India"] })], "tool_use");
    if (first.includes("podium")) return send([use("show_chart", { kind: "bar", variable: "world-bank-development::population", order: "top", n: 5 })], "tool_use");
    if (first.includes("wrong id")) return send([use("get_values", { variable: "nope::nothing", places: ["India"] })], "tool_use");
    if ((first.includes("why") || first.includes("explain")) && first.includes("life expectancy")) return send([{ type: "text", text: "Let me check the figures." }, use("get_values", { variable: "world-bank-development::life_expectancy", places: [first.includes("china") ? "China" : "India"] })], "tool_use");
    if (first.includes("owe")) return send([use("get_series", { variable: "us-national-debt::total_public_debt", from: 2015 })], "tool_use");
    if (first.includes("studies begin")) return send([use("get_series", { variable: "clinical-trials-started::studies_started" })], "tool_use");
    if (first.includes("free and fair")) return send([use("rank", { variable: "democracy-and-rights::electoral_democracy_index", order: "top", n: 5 })], "tool_use");
    if (first.includes("picture of joblessness")) return send([use("show_chart", { kind: "line", variable: "us-economy-monthly::unemployment_rate", from: 2019 })], "tool_use");
    if (first.includes("emit")) return send([use("rank", { variable: "co2-and-greenhouse-gases::co2", order: "top", n: 5 })], "tool_use");
    if (first.includes("oil")) return send([use("get_series", { variable: "crude-oil-prices::brent_usd_per_barrel", from: 2019, to: 2023 })], "tool_use");
    if (first.includes("shak")) return send([use("recent_earthquakes", {})], "tool_use");
    return send([{ type: "text", text: "From general knowledge, not this site's data: here is a short answer to \"" + first.slice(0, 80) + "\"." }], "end_turn");
  });
});
await new Promise(r => model.listen(8768, r));
const vars = { ANTHROPIC_BASE_URL: "http://127.0.0.1:8768", ANTHROPIC_API_KEY: "test", DATA_AI_STORE: "memory", DATA_AI_DAILY_USD: "5", DATA_AI_MONTHLY_USD: "5", DATA_AI_PER_MINUTE: "100000", DATA_AI_CATALOG_URL: "http://127.0.0.1:8768/datasets.json" };
globalThis.Netlify = { env: { get: k => vars[k] } }; process.env.ANTHROPIC_BASE_URL = vars.ANTHROPIC_BASE_URL; process.env.ANTHROPIC_API_KEY = "test";
let fn = (await import(FUNCTION)).default, gen = 0, old = false;
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/__set") { for (const [k, v] of u.searchParams) vars[k] = v; fn = (await import(FUNCTION + "?g=" + ++gen)).default; res.end("ok"); return; }
  if (u.pathname === "/__old") { old = u.searchParams.get("on") === "1"; res.end("ok"); return; }                       // behave like the service before streaming, to check the page still works with it
  if (u.pathname === "/__log") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(log)); return; }
  let body = ""; for await (const c of req) body += c;
  if (old && body) { const j = JSON.parse(body); delete j.stream; body = JSON.stringify(j); }
  const r = await fn(new Request("http://x" + req.url, { method: req.method, headers: req.headers, body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : body }), { waitUntil: p => p });
  res.statusCode = r.status; r.headers.forEach((v, k) => res.setHeader(k, v));
  if (old && req.method === "GET") { const j = await r.json(); delete j.stream; delete j.tools; res.end(JSON.stringify(j)); return; }
  if (r.status === 204 || !r.body) { res.end(); return; }
  for await (const piece of r.body) res.write(piece);                                                               // passed on piece by piece, as Netlify does
  res.end();
}).listen(8767, () => console.log("ready"));
