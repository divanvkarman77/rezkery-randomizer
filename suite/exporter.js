(function (root) {
  "use strict";
  const C = root.RezkaSuite;
  if (typeof module === "object" && !root.RezkaSuiteViewer)
    require("./offline-viewer.js");
  const portable = [
    "movies",
    "aliases",
    "catalogs",
    "memberships",
    "userState",
    "collections",
    "tags",
    "history",
    "details",
    "tombstones",
  ];
  async function selection(repo, parent) {
    if (!parent) return null;
    const ids = new Set((await repo.children(parent)).map((x) => x.movieId)),
      assets = new Set(),
      keys = [...ids];
    for (let n = 0; n < keys.length; n += 100)
      for (const m of await repo.getMany("movies", keys.slice(n, n + 100)))
        if (m?.posterAsset) assets.add(m.posterAsset);
    return { parent, ids, assets };
  }
  async function* records(repo, store, selected) {
    if (!selected) {
      yield* repo.iterate(store);
      return;
    }
    if (store === "movies" || store === "assets") {
      const ids = [...(store === "movies" ? selected.ids : selected.assets)];
      for (const id of ids) {
        const row = await repo.get(store, id);
        if (row) yield row;
      }
      return;
    }
    for await (const row of repo.iterate(store)) {
      let yes;
      if (["catalogs", "collections", "tags"].includes(store))
        yes = row.id === selected.parent;
      else if (store === "memberships")
        yes = row.parentId === selected.parent && selected.ids.has(row.movieId);
      else if (store === "tombstones") yes = selected.ids.has(row.targetId);
      else yes = selected.ids.has(row.movieId || row.id);
      if (yes) yield row;
    }
  }
  async function* json(
    repo,
    { media = false, scope = "", selected = null } = {},
  ) {
    selected = selected || (await selection(repo, scope));
    yield '{"format":"rezka-suite","schemaVersion":1,"exportedAt":' +
      JSON.stringify(new Date().toISOString());
    for (const store of [...portable, ...(media ? ["assets"] : [])]) {
      yield ',"' + store + '":[';
      let first = true;
      for await (const row of records(repo, store, selected)) {
        yield (first ? "" : ",") + JSON.stringify(row);
        first = false;
      }
      yield "]";
    }
    yield "}";
  }
  const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
    for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  function crc(bytes, value = 0xffffffff) {
    for (const b of bytes) value = crcTable[(value ^ b) & 255] ^ (value >>> 8);
    return value >>> 0;
  }
  function header(size, values) {
    const b = new Uint8Array(size),
      v = new DataView(b.buffer);
    for (const [offset, n, width] of values)
      width === 2 ? v.setUint16(offset, n, true) : v.setUint32(offset, n, true);
    return b;
  }
  async function* zip(repo, { scope = "" } = {}) {
    const selected = await selection(repo, scope);
    let offset = 0;
    const central = [],
      enc = new TextEncoder();
    async function* entry(name, chunks) {
      const n = enc.encode(name),
        start = offset,
        h = header(30, [
          [0, 0x04034b50],
          [4, 20, 2],
          [6, 0x808, 2],
          [26, n.length, 2],
        ]);
      yield h;
      yield n;
      offset += h.length + n.length;
      let sum = 0xffffffff,
        size = 0;
      for await (const chunk of chunks) {
        const b = typeof chunk === "string" ? enc.encode(chunk) : chunk;
        sum = crc(b, sum);
        size += b.length;
        offset += b.length;
        if (offset > 0xffffffff)
          throw Error("Пакет больше 4 ГБ: разделите библиотеку");
        yield b;
      }
      sum = (sum ^ 0xffffffff) >>> 0;
      const tail = header(16, [
        [0, 0x08074b50],
        [4, sum],
        [8, size],
        [12, size],
      ]);
      yield tail;
      offset += 16;
      const ch = header(46, [
        [0, 0x02014b50],
        [4, 20, 2],
        [6, 20, 2],
        [8, 0x808, 2],
        [16, sum],
        [20, size],
        [24, size],
        [28, n.length, 2],
        [42, start],
      ]);
      central.push(ch, n);
    }
    yield* entry("database.json", json(repo, { selected }));
    let count = 1;
    for await (const a of records(repo, "assets", selected)) {
      if (++count > 65535)
        throw Error("Слишком много медиа для ZIP: используйте несколько копий");
      yield* entry("assets/" + a.id.replace("image:", "") + ".json", [
        JSON.stringify(a),
      ]);
    }
    const start = offset;
    for (const b of central) {
      offset += b.length;
      yield b;
    }
    yield header(22, [
      [0, 0x06054b50],
      [8, count, 2],
      [10, count, 2],
      [12, offset - start],
      [16, start],
    ]);
  }
  async function zipEntries(file) {
    const tail = new Uint8Array(
        await file.slice(Math.max(0, file.size - 65557)).arrayBuffer(),
      ),
      v = new DataView(tail.buffer);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--)
      if (v.getUint32(i, true) === 0x06054b50) {
        end = i;
        break;
      }
    if (end < 0) throw Error("Повреждённый ZIP");
    const count = v.getUint16(end + 10, true),
      length = v.getUint32(end + 12, true),
      offset = v.getUint32(end + 16, true);
    if (length > 32 * 1024 * 1024 || offset + length > file.size)
      throw Error("Некорректный каталог ZIP");
    const buf = await file.slice(offset, offset + length).arrayBuffer(),
      d = new DataView(buf),
      entries = [];
    let at = 0,
      total = 0;
    for (let i = 0; i < count; i++) {
      if (at + 46 > d.byteLength || d.getUint32(at, true) !== 0x02014b50)
        throw Error("Повреждён каталог ZIP");
      const method = d.getUint16(at + 10, true),
        size = d.getUint32(at + 24, true),
        nameLen = d.getUint16(at + 28, true),
        extra = d.getUint16(at + 30, true),
        comment = d.getUint16(at + 32, true),
        local = d.getUint32(at + 42, true),
        sum = d.getUint32(at + 16, true),
        name = new TextDecoder().decode(new Uint8Array(buf, at + 46, nameLen));
      if (
        method !== 0 ||
        !/^(database\.json|assets\/[a-f0-9]{64}\.json)$/.test(name)
      )
        throw Error(
          "Поддерживается пакет Suite без сжатия с безопасными путями",
        );
      const lh = new DataView(
        await file.slice(local, local + 30).arrayBuffer(),
      );
      if (lh.getUint32(0, true) !== 0x04034b50)
        throw Error("Повреждён заголовок ZIP");
      const begin =
        local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      if (begin + size > offset || total + size > 4 * 1024 ** 3)
        throw Error("Некорректный размер ZIP");
      total += size;
      entries.push({ name, size, sum, blob: file.slice(begin, begin + size) });
      at += 46 + nameLen + extra + comment;
    }
    if (new Set(entries.map((x) => x.name)).size !== entries.length)
      throw Error("Повторяющиеся файлы ZIP");
    return entries;
  }
  async function* checkedText(entry) {
    let sum = 0xffffffff;
    for (let p = 0; p < entry.size; p += 262144) {
      sum = crc(
        new Uint8Array(await entry.blob.slice(p, p + 262144).arrayBuffer()),
        sum,
      );
    }
    if ((sum ^ 0xffffffff) >>> 0 !== entry.sum)
      throw Error("Неверная контрольная сумма " + entry.name);
    yield* C.blobText(entry.blob);
  }
  async function* offline(repo, { scope = "" } = {}) {
    yield '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rezka — автономная библиотека</title><style>body{font:16px system-ui;background:#171c25;color:#f4f5f7;margin:24px}button,input,select{font:inherit;padding:10px;margin:4px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}article{padding:14px;background:#263143;border-radius:12px}img{width:100%;height:var(--poster-height,230px);object-fit:contain}a{color:#b7d8ff}body.light{background:#fff;color:#172137}.light article{background:#eef2f7}p{white-space:pre-wrap}dialog{max-width:650px;width:85%}*{box-sizing:border-box}input,select{max-width:100%}main.list article{display:grid;grid-template-columns:100px 1fr;margin-bottom:10px}main.list article img{width:95px;height:140px;grid-row:span 2}article{min-width:0;overflow-wrap:anywhere}#largePoster{height:auto;max-height:65vh}#posterZoom{width:96vw;max-width:none}#zoomImage{height:auto;max-height:85vh}dialog img{cursor:zoom-in}</style><h1>Моя библиотека</h1><button id="theme">☀ / ☾</button><button id="random">Случайная карточка</button><input id="q" placeholder="Поиск"><input id="year" type="number" placeholder="Год"><select id="type"><option value="">Все типы</option><option value="film">Фильмы</option><option value="series">Сериалы</option><option value="cartoon">Мультфильмы</option><option value="anime">Аниме</option></select><input id="mirror" placeholder="Зеркало, например https://rezka.fi"><select id="view"><option value="cards">Карточки</option><option value="list">Список</option></select><label>Колонки (0 — авто)<input id="columns" type="range" min="0" max="8" value="0"></label><select id="posterHeight"><option value="150">Постеры 150 px</option><option value="230" selected>Постеры 230 px</option><option value="350">Постеры 350 px</option><option value="480">Постеры 480 px</option></select><p id="count"></p><main></main><button id="more">Ещё</button><dialog id="movieDetail"><button id="previousMovie">←</button><button id="nextMovie">→</button><button id="close">Закрыть</button><h2></h2><img id="largePoster" hidden alt="Постер"><p></p><a target="_blank" rel="noopener">Открыть на сайте</a></dialog><dialog id="posterZoom"><button id="zoomClose">Закрыть постер</button><img id="zoomImage" alt="Постер"></dialog><script type="application/json" id="rezka-suite-data">';
    let bytes = 0;
    for await (const chunk of json(repo, { media: true, scope })) {
      bytes += new TextEncoder().encode(chunk).length;
      if (bytes > 64 * 1024 * 1024)
        throw Error(
          "HTML превысил 64 МБ. Сохраните ZIP с медиа вместо одного HTML",
        );
      yield chunk.replace(/</g, "\\u003c");
    }
    yield "</script><script>(" +
      root.RezkaSuiteViewer.mount.toString() +
      ")();</script></html>";
  }
  root.RezkaSuiteExport = { json, zip, zipEntries, checkedText, offline, crc };
  if (typeof module === "object") module.exports = root.RezkaSuiteExport;
})(typeof globalThis !== "undefined" ? globalThis : this);
