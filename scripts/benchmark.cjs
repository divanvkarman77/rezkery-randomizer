const fs = require("node:fs"),
  { performance } = require("node:perf_hooks");
require("fake-indexeddb/auto");
const C = require("../suite/core"),
  { Repository } = require("../suite/repository");
(async () => {
  const r = new Repository("suite-benchmark-" + Date.now()),
    results = [];
  let start = performance.now(),
    n = 0;
  for (const target of [10000, 50000, 100000]) {
    while (n < target) {
      const rows = [];
      for (let end = Math.min(n + 500, target); n < end; n++) {
        const m = C.normalize({
          url: "https://rezka.fi/films/" + (1000000 + n) + "-synthetic.html",
          title: "Тестовый фильм " + n,
          year: 1980 + (n % 40),
          type: n % 4 ? "film" : "series",
        }).movie;
        rows.push(["movies", m]);
      }
      await r.batch(rows);
    }
    const t = performance.now(),
      first = await r.query({ limit: 60 }),
      f = performance.now(),
      filtered = await r.query({
        year: 1990,
        type: "film",
        q: "тестовый",
        limit: 60,
      }),
      end = performance.now();
    if (first.items.length !== 60 || !filtered.items.length)
      throw Error("Неверный результат");
    results.push({
      movies: target,
      insertCumulativeMs: Math.round(t - start),
      firstPageMs: Math.round((f - t) * 10) / 10,
      filteredPageMs: Math.round((end - f) * 10) / 10,
      rssMB: Math.round(process.memoryUsage().rss / 1048576),
      environment: "Node 22+, fake-indexeddb, metadata only",
    });
    console.log(JSON.stringify(results.at(-1)));
  }
  fs.mkdirSync("dist", { recursive: true });
  fs.writeFileSync("dist/benchmark.json", JSON.stringify(results, null, 2));
  r.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
