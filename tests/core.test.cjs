const { test } = require("node:test");
const assert = require("node:assert/strict");
require("fake-indexeddb/auto");
const { DOMParser } = require("linkedom");
global.DOMParser = DOMParser;
const C = require("../suite/core.js");
const { Repository } = require("../suite/repository.js");
const { Importer } = require("../suite/importer.js");
async function* chunks(text, n = 19) {
  for (let i = 0; i < text.length; i += n) yield text.slice(i, i + n);
}
const movie = (id, extra = {}) => ({
  url: `https://rezka.fi/films/drama/${id}-example-1990.html`,
  title: `Фильм ${id}`,
  year: 1990,
  ...extra,
});
test("numeric identity survives mirror and renamed slug; title is not an ID", () => {
  assert.equal(
    C.identity(movie(123)),
    C.identity({
      ...movie(123),
      url: "https://rezkery.com/series/123-renamed.html",
    }),
  );
  assert.notEqual(C.identity(movie(123)), C.identity(movie(124)));
  assert.equal(C.normalize(movie(123)).movie.year, 1990);
  assert.equal(
    C.normalize(
      movie(123, { year: "", url: "https://rezka.fi/films/123-unknown.html" }),
    ).movie.year,
    null,
  );
});
test("JSON streaming keeps nested categories, tags, arrays and escaped strings", async () => {
  const out = [],
    p = new C.JsonRecords((x) => out.push(x));
  for await (const s of chunks(
    JSON.stringify({
      format: "rezka-suite",
      schemaVersion: 1,
      movies: [
        movie(1, {
          categories: [{ id: "x" }],
          details: { cast: ["A", "B"] },
          title: 'а \\" <script>',
        }),
      ],
    }),
    1,
  ))
    await p.feed(s);
  await p.finish();
  assert.equal(out.length, 1);
  assert.equal(out[0].value.categories.length, 1);
  assert.equal(p.metadata.format, "rezka-suite");
});
test("streaming parser rejects invalid/truncated JSON and prototype keys are inert", async () => {
  for (const text of [
    '{"movies":[{},]}',
    '{"x":1 "y":2}',
    '{"x":',
    "{}{}",
    "[1,]",
  ]) {
    const p = new C.JsonRecords(() => {});
    await assert.rejects(async () => {
      await p.feed(text);
      await p.finish();
    });
  }
  const p = new C.JsonRecords(() => {});
  await p.feed('{"__proto__":{"polluted":true}}');
  await p.finish();
  assert.equal({}.polluted, undefined);
});
test("pagination preserves current scope and query, with no fixed page cap", () => {
  const doc = new DOMParser().parseFromString(
    '<div class="b-navigation"><a href="/page/1/?filter=last&genre=1">1</a><a href="/page/9999/?filter=last&genre=1">9999</a><a href="/year/2026/page/2/">2</a></div>',
    "text/html",
  );
  assert.equal(
    C.pagination(doc, "https://rezkery.com/?genre=1&filter=last").max,
    9999,
  );
  assert.equal(
    C.pageUrl(
      "https://rezka.fi/films/best/foreign/1990/?filter=last&genre=1",
      7,
    ),
    "https://rezka.fi/films/best/foreign/1990/page/7/?filter=last&genre=1",
  );
});
test("import is staged, idempotent, separates full catalogue and history; portable roundtrip", async () => {
  const r = new Repository("test-" + Math.random());
  const input = {
    version: 1,
    categories: [
      {
        id: "https://rezka.fi/year/1990/",
        baseUrl: "https://rezka.fi/year/1990/",
        title: "1990",
        cards: [movie(1), movie(2)],
      },
    ],
  };
  const i = new Importer(r);
  await i.json(chunks(JSON.stringify(input)));
  assert.equal(await r.count("movies"), 0);
  await i.apply();
  assert.equal(await r.count("movies"), 2);
  assert.equal(await r.count("history"), 0);
  assert.equal(await r.count("memberships"), 2);
  await r.put("userState", { id: "rezka:1", note: "Моя заметка", rating: 8 });
  const j = new Importer(r);
  await j.json(chunks(JSON.stringify(input)));
  await j.apply();
  assert.equal(await r.count("movies"), 2);
  assert.equal((await r.get("userState", "rezka:1")).note, "Моя заметка");
  const old = new Importer(r);
  await old.json(
    chunks(
      JSON.stringify({
        format: "rezkery-randomizer-db",
        version: 1,
        items: [movie(1)],
      }),
    ),
  );
  await old.apply();
  assert.equal(await r.count("history"), 1);
  const future = new Importer(r);
  await assert.rejects(() =>
    future.json(
      chunks('{"format":"rezka-suite","schemaVersion":99,"movies":[]}'),
    ),
  );
  assert.equal(await r.count("movies"), 2);
  r.close();
});
test("HTML imports unquoted attributes, cached posters, hostile script as inert data", async () => {
  const r = new Repository("html-" + Math.random()),
    i = new Importer(r);
  const s =
    '<html><script>throw Error("never execute")</script><h1>Каталог</h1><div class=b-content__inline_item data-id=13><div class=b-content__inline_item-cover><img src="data:image/png;base64,AAAA"></div><div class=b-content__inline_item-link><a href="https://rezka.fi/films/13-film-1990.html">Название</a><div>1990, США</div></div></div></html>';
  await i.html(chunks(s, 7));
  await i.apply();
  assert.equal(await r.count("movies"), 1);
  assert.equal(await r.count("assets"), 1);
  assert.equal((await r.get("movies", "rezka:13")).year, 1990);
  r.close();
});
test("8 MB style string is streamed within a bounded heap", () => {
  const { spawnSync } = require("node:child_process");
  const file = require.resolve("../suite/core");
  const code = `const C=require(${JSON.stringify(file)});(async()=>{let count=0;const p=new C.JsonRecords(x=>{if(x.kind==='cards')count++});await p.feed('{"categories":[{"styles":"');for(let i=0;i<8192;i++)await p.feed('x'.repeat(1024));await p.feed('","cards":[{"url":"https://rezka.fi/films/5-test.html"}]}]}');await p.finish();if(count!==1)throw Error('record lost');console.log('ok')})().catch(e=>{console.error(e);process.exitCode=1})`;
  const r = spawnSync(
    process.execPath,
    ["--max-old-space-size=128", "-e", code],
    { encoding: "utf8", timeout: 20000 },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ok/);
});
test("path identity upgrades atomically with notes, history and folder links", async () => {
  const r = new Repository("upgrade-" + Math.random());
  const old = C.normalize({
    url: "https://rezka.fi/films/drama/example.html",
    title: "Фильм",
  }).movie;
  await r.batch([
    ["movies", old],
    ["history", { id: old.id, movieId: old.id, at: 1 }],
    ["userState", { id: old.id, note: "Не терять" }],
    [
      "memberships",
      { id: "folder|" + old.id, parentId: "folder", movieId: old.id },
    ],
    ["aliases", { id: C.path(old.url), movieId: old.id }],
  ]);
  const next = C.normalize({ ...old, id: "rezka:77", rezkaId: "77" }).movie;
  await C.upgradeIdentity(r, next);
  assert.equal(await r.count("movies"), 1);
  assert.equal((await r.get("userState", "rezka:77")).note, "Не терять");
  assert.equal((await r.children("folder"))[0].movieId, "rezka:77");
  assert.equal((await r.get("history", "rezka:77")).at, 1);
  r.close();
});
test("Library, Manager, Saver and Desktop adapters preserve their relations", async () => {
  const r = new Repository("adapters-" + Math.random());
  const fixtures = [
    {
      format: "rezka-library",
      items: {
        one: {
          id: "rezka:8",
          url: "https://rezka.fi/films/8-test.html",
          title: "Library",
        },
      },
      categories: {
        a: { id: "https://rezka.fi/favorites/22/", name: "RANDOM" },
      },
      memberships: {
        a: { itemId: "rezka:8", categoryUrl: "https://rezka.fi/favorites/22/" },
      },
    },
    {
      format: "RezkaCatalogManager",
      db: {
        movies: [
          {
            sourceHref: "https://rezka.fi/films/9-test.html",
            title: "Manager",
            categories: [
              { key: "https://rezka.fi/?filter=last&genre=1", label: "Фильмы" },
            ],
          },
        ],
        userState: [
          {
            sourceHref: "https://rezka.fi/films/9-test.html",
            note: "Личная",
            rating: 7,
          },
        ],
        collections: [{ id: "local", name: "Избранные" }],
        collectionItems: [
          {
            collectionId: "local",
            sourceHref: "https://rezka.fi/films/9-test.html",
          },
        ],
        tags: [{ id: "tag", name: "Тест" }],
        movieTags: [
          { tagId: "tag", sourceHref: "https://rezka.fi/films/9-test.html" },
        ],
      },
    },
    [
      {
        id: 10,
        url: "https://rezka.fi/films/10-test.html",
        title: "Desktop",
        entity_type: 1,
      },
    ],
  ];
  for (const f of fixtures) {
    const i = new Importer(r);
    await i.json(chunks(JSON.stringify(f)));
    await i.apply();
  }
  assert.equal(await r.count("movies"), 3);
  assert.equal(await r.count("collections"), 1);
  assert.equal(await r.count("tags"), 1);
  assert.equal((await r.children("collection:local")).length, 1);
  assert.equal((await r.children("tag:tag")).length, 1);
  assert.equal((await r.get("userState", "rezka:9")).note, "Личная");
  assert.equal((await r.children("catalog:desktop-fav")).length, 1);
  r.close();
});
