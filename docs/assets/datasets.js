/* Datasets page: filter the variable tables as you type. The page itself is plain HTML written by scripts/build_site.py. */
(function () {
  const q = $("#vq"), count = $("#vcount"), arts = $$(".dsx"), total = $$(".vars tbody tr").length;
  function run() {
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean); let shown = 0;
    arts.forEach(a => {
      let n = 0;
      $$(".vars tbody tr", a).forEach(tr => { const ok = words.every(w => tr.dataset.q.includes(w)); tr.hidden = !ok; if (ok) n++; });
      a.hidden = !!words.length && !n; $(".vars", a).open = !!words.length && n > 0; shown += n;
    });
    count.textContent = words.length ? `${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} variables match.${shown ? "" : " Try one shorter word."}` : "";
  }
  q.addEventListener("input", run);
  const start = new URLSearchParams(location.search).get("q"); if (start) { q.value = start; run(); }
})();
