const { test } = require("node:test"),
  assert = require("node:assert/strict");
require("fake-indexeddb/auto");
global.DOMParser = require("linkedom").DOMParser;
const C = require("../suite/core");
const { Repository } = require("../suite/repository");
const { Importer, hash } = require("../suite/importer");
const E = require("../suite/exporter");
const { Runner } = require("../suite/jobs");
async function populate(r) {
  const image = "data:image/png;base64,AAAA",
    id = "image:" + (await hash(image));
  await r.batch([
    [
      "movies",
      C.normalize({
        url: "https://rezka.fi/films/42-test-1990.html",
        title: "Тест <img onerror=bad()>",
        posterAsset: id,
        year: 1990,
      }).movie,
    ],
    ["assets", { id, data: image }],
    ["details", { id: "rezka:42", description: "Текст </script> безопасен" }],
    ["userState", { id: "rezka:42", rating: 8, note: "Заметка", updatedAt: 1 }],
    ["catalogs", { id: "catalog:/year/1990", title: "Каталог" }],
    [
      "memberships",
      {
        id: "catalog:/year/1990|rezka:42",
        parentId: "catalog:/year/1990",
        movieId: "rezka:42",
      },
    ],
    ["history", { id: "rezka:42", movieId: "rezka:42", at: 1 }],
  ]);
}
test("full ZIP roundtrip preserves media, notes, folders, history and descriptions", async () => {
  const r = new Repository("zip-" + Math.random());
  await populate(r);
  const parts = [];
  for await (const b of E.zip(r)) parts.push(b);
  const f = new File(parts, "suite.zip");
  const target = new Repository("target-" + Math.random()),
    i = new Importer(target);
  await i.file(f);
  await i.apply();
  for (const s of [
    "movies",
    "assets",
    "details",
    "userState",
    "catalogs",
    "memberships",
    "history",
  ])
    assert.equal(await target.count(s), 1, s);
  assert.equal(
    (await target.get("details", "rezka:42")).description,
    "Текст </script> безопасен",
  );
  assert.equal((await target.get("userState", "rezka:42")).note, "Заметка");
  r.close();
  target.close();
});
test("metadata copy excludes images, secrets and transient jobs", async () => {
  const r = new Repository("metadata-" + Math.random());
  await populate(r);
  await r.put("settings", { id: "gist", token: "private-token" });
  let s = "";
  for await (const c of E.json(r)) s += c;
  const data = JSON.parse(s);
  assert.equal(data.assets, undefined);
  assert.equal(data.settings, undefined);
  assert.ok(!s.includes("private-token"));
  r.close();
});
test("offline viewer embeds safe JSON and includes cached images only", async () => {
  const r = new Repository("offline-" + Math.random());
  await populate(r);
  let s = "";
  for await (const c of E.offline(r)) s += c;
  const doc = new DOMParser().parseFromString(s, "text/html"),
    data = JSON.parse(doc.querySelector("#rezka-suite-data").textContent);
  assert.equal(data.movies.length, 1);
  assert.equal(data.assets.length, 1);
  assert.equal(doc.querySelectorAll("script").length, 2);
  r.close();
});
test("corrupt ZIP checksum is rejected before application", async () => {
  const r = new Repository("badzip-" + Math.random());
  await populate(r);
  const parts = [];
  for await (const c of E.zip(r)) parts.push(c);
  const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
  bytes[50] ^= 1;
  const t = new Repository("badzip-target-" + Math.random()),
    i = new Importer(t);
  await assert.rejects(() => i.file(new File([bytes], "corrupt.zip")));
  assert.equal(await t.count("movies"), 0);
  r.close();
  t.close();
});
test("durable job resumes with checkpoint; challenge stops requests for all jobs", async () => {
  const r = new Repository("jobs-" + Math.random());
  let calls = 0,
    now = 100000;
  const transport = async (j, c) => {
    calls++;
    if (calls === 2) return { challenge: true };
    const n = +C.path(c.url).match(/page\/(\d+)/)?.[1] || 1;
    return {
      url: c.url,
      cards: [
        {
          url: "https://rezka.fi/films/" + n + "-test.html",
          title: "Тест " + n,
        },
      ],
      pagination: { max: 3, current: n, exact: true },
      signature: "page" + n,
      title: "Тест",
    };
  };
  const runner = new Runner(r, transport, {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  const job = await runner.enqueue("scan", { url: "https://rezka.fi/" });
  await runner.tick();
  assert.equal((await r.get("jobs", job.id)).next, 2);
  await runner.tick();
  assert.equal((await r.get("jobs", job.id)).status, "waiting_challenge");
  await runner.enqueue("scan", { url: "https://rezka.fi/year/1990/" });
  await runner.tick();
  assert.equal(calls, 2);
  const restored = new Runner(r, transport, {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  await restored.resume(job.id);
  await restored.tick();
  assert.equal((await r.get("jobs", job.id)).next, 3);
  r.close();
});
test("duplicate page fingerprint is detected across non-adjacent page numbers", () => {
  const r = new Runner(null, null),
    j = {},
    response = (n) => ({
      url: C.pageUrl("https://rezka.fi/", n),
      pagination: { current: n },
      signature: n === 3 ? "A" : n === 1 ? "A" : "B",
    });
  r.checkPage(j, response(1), 1, "https://rezka.fi/");
  r.checkPage(j, response(2), 2, "https://rezka.fi/");
  assert.throws(
    () => r.checkPage(j, response(3), 3, "https://rezka.fi/"),
    /повторил/,
  );
});
test("split media after a staging flush keeps full movie metadata", async () => {
  const r = new Repository("split-" + Math.random()),
    i = new Importer(r);
  await i.movie({
    url: "https://rezka.fi/films/17-test.html",
    title: "Не терять название",
    year: 1990,
  });
  await i.flush();
  await i.record({
    kind: "posters",
    value: {
      sourceHref: "https://rezka.fi/films/17-test.html",
      data: "data:image/png;base64,AAAA",
    },
  });
  await i.flush();
  await i.apply();
  const movie = await r.get("movies", "rezka:17");
  assert.equal(movie.title, "Не терять название");
  assert.ok(movie.posterAsset);
  assert.equal(await r.count("assets"), 1);
  r.close();
});
test("state conflict keeps both versions, newer note wins, explicit zero rating survives", () => {
  const a = { id: "x", note: "Старое", rating: 8, updatedAt: 1 },
    b = { id: "x", note: "Новое", rating: 0, updatedAt: 2 },
    m = C.mergeState(a, b);
  assert.equal(m.note, "Новое");
  assert.equal(m.rating, 0);
  assert.equal(m.conflicts[0].note, "Старое");
});
test("future schema in an embedded HTML backup is rejected before changing library", async () => {
  const r = new Repository("future-html-" + Math.random()),
    i = new Importer(r);
  await assert.rejects(() =>
    i.html([
      '<script id="rezka-suite-data" type="application/json">{"format":"rezka-suite","schemaVersion":99,"movies":[{"url":"https://rezka.fi/films/1-test.html"}]}</script>',
    ]),
  );
  assert.equal(await r.count("movies"), 0);
  r.close();
});
test("selected collection export excludes unrelated movies and media", async () => {
  const r = new Repository("selection-" + Math.random());
  await populate(r);
  await r.put(
    "movies",
    C.normalize({
      url: "https://rezka.fi/films/99-other.html",
      title: "Не экспортировать",
    }).movie,
  );
  let text = "";
  for await (const c of E.json(r, { media: true, scope: "catalog:/year/1990" }))
    text += c;
  const data = JSON.parse(text);
  assert.equal(data.movies.length, 1);
  assert.equal(data.assets.length, 1);
  assert.equal(data.memberships.length, 1);
  assert.ok(!text.includes("Не экспортировать"));
  r.close();
});
test("unknown release years stay visible when sorting by year", async () => {
  const r = new Repository("null-year-" + Math.random());
  await r.put(
    "movies",
    C.normalize({
      url: "https://rezka.fi/films/55-unknown.html",
      title: "Без года",
    }).movie,
  );
  const found = await r.query({ sort: "year", limit: 60 });
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].year, null);
  r.close();
});
test("manual corrections preserve their search index and intentional empty year", () => {
  const a = C.normalize({
    url: "https://rezka.fi/films/8-film-1990.html",
    title: "Моё название",
    year: null,
    manual: ["title", "year"],
  }).movie;
  const b = C.normalize({
      url: a.url,
      title: "Сайт обновился",
      year: 1990,
    }).movie,
    m = C.merge(a, b);
  assert.equal(m.year, null);
  assert.equal(m.yearKey, 0);
  assert.equal(m.title, "Моё название");
  assert.ok(m.search.includes("мое название"));
  assert.ok(!m.search.includes("обновился"));
});
