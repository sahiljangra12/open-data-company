/* The installed app's helper. It always asks the network first, so nothing is ever stale while you are online,
   and keeps a copy of what it fetched so the app still opens, with the last figures it saw, when you are offline.
   Large data files and the AI service are never stored. */
const KEEP = "open-data-app-v1";
const SHELL = ["./", "index.html", "ask.html", "datasets.html", "explore.html", "research.html", "mydata.html", "updates.html", "brief.html", "guide.html",
  "assets/site.css", "assets/core.js", "assets/charts.js", "assets/concepts.js", "assets/home.js", "data/datasets.json", "data/countries.json", "data/pulse.json", "img/icon.svg",
  "fonts/barlow-latin-400-normal.woff2", "fonts/barlow-latin-500-normal.woff2", "fonts/barlow-latin-600-normal.woff2", "fonts/barlow-condensed-latin-600-normal.woff2"];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(KEEP).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null))))); });
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== KEEP).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;                         // other sites and the AI service go straight to the network
  const store = !/\/data\/sets\/|\/vendor\/|\.(csv|parquet|zip)$/.test(u.pathname);          // whole datasets are too large to keep a second copy of
  e.respondWith(fetch(r).then(res => { if (store && res.ok && res.type === "basic") { const copy = res.clone(); caches.open(KEEP).then(c => c.put(r, copy)); } return res; })
    .catch(() => caches.match(r, { ignoreSearch: true }).then(hit => hit || (r.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
