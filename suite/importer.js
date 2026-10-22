(function (root) {
  "use strict";
  const C = root.RezkaSuite;
  function categoryId(raw, fallback) {
    if (/^catalog:/.test(raw.id || "")) return raw.id;
    const source =
      raw.baseUrl ||
      raw.url ||
      raw.source ||
      raw.categoryKey ||
      raw.key ||
      raw.id ||
      "";
    const value = C.url(String(source).replace(/^cat:/, ""));
    const p = value ? C.scope(value).key : "";
    return source && p ? "catalog:" + p : "catalog:" + fallback;
  }
  function ref(value) {
    if (!value) return "";
    if (/^(rezka:|path:)/.test(value)) return value;
    return C.identity({ id: value, url: value });
  }
  async function hash(value) {
    const bytes = new TextEncoder().encode(value);
    const out = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(out), (x) =>
      x.toString(16).padStart(2, "0"),
    ).join("");
  }
  class Importer {
    constructor(repo, { progress = () => {}, signal = null } = {}) {
      this.repo = repo;
      this.progress = progress;
      this.signal = signal;
      this.session =
        "import-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      this.n = 0;
      this.queuedBytes = 0;
      this.queue = [];
      this.movies = new Set();
      this.stats = { movies: 0, records: 0, skipped: 0, assets: 0 };
      this.legacy = false;
    }
    async stage(store, row) {
      const id = this.session + ":" + store + ":" + row.id;
      const previous = this.queue.find((x) => x[1].id === id);
      if (previous) previous[1].row = C.merge(previous[1].row, row);
      else
        this.queue.push(["staging", { id, session: this.session, store, row }]);
      this.queuedBytes += row.data?.length || 0;
      if (this.queue.length >= 100 || this.queuedBytes > 2 * 1024 * 1024)
        await this.flush();
    }
    async flush() {
      if (this.signal?.aborted) throw Error("Импорт отменён");
      if (this.queue.length) {
        this.queuedBytes = 0;
        const batch = this.queue.splice(0),
          previous = await this.repo.getMany(
            "staging",
            batch.map((x) => x[1].id),
          );
        batch.forEach((x, i) => {
          if (previous[i])
            x[1].row =
              x[1].store === "userState"
                ? C.mergeState(previous[i].row, x[1].row)
                : C.merge(previous[i].row, x[1].row);
        });
        await this.repo.batch(batch);
      }
      this.progress({ ...this.stats });
    }
    async image(movie, data) {
      if (!data) return;
      const id = "image:" + (await hash(data));
      movie.posterAsset = id;
      await this.stage("assets", {
        id,
        data,
        bytes: Math.round(data.length * 0.75),
        movieId: movie.id,
      });
      this.stats.assets++;
    }
    async movie(raw, parent, markSeen = false) {
      const n = C.normalize(raw, parent?.baseUrl || parent?.url);
      if (!n) {
        this.stats.skipped++;
        return;
      }
      this.movies.add(n.movie.id);
      this.stats.movies = this.movies.size;
      await this.image(n.movie, n.poster);
      await this.stage("movies", n.movie);
      if (n.detail.description || n.detail.director || n.detail.cast)
        await this.stage("details", n.detail);
      for (const alias of [
        raw.id,
        raw.contentKey,
        raw.sourceHref,
        raw.url,
        raw.href,
        ...n.movie.aliases,
      ].filter(Boolean))
        await this.stage("aliases", { id: String(alias), movieId: n.movie.id });
      if (parent) {
        const cid = categoryId(parent, "source");
        await this.stage("catalogs", {
          id: cid,
          title: parent.title || parent.name || "Импортированный каталог",
          source: parent.baseUrl || parent.url || "",
          kind: /favorites|desktop/i.test(cid) ? "folder" : "catalog",
        });
        await this.stage("memberships", {
          id: cid + "|" + n.movie.id,
          parentId: cid,
          movieId: n.movie.id,
        });
        if (
          /^random$/i.test(
            (parent.title || parent.name || "").replace(/\s*\(\d+\)\s*$/, ""),
          )
        )
          markSeen = true;
      }
      for (let cat of raw.categories || raw.relations || []) {
        if (typeof cat === "string") cat = { id: cat };
        const cid = categoryId(cat, String(cat.key || cat.id || "source"));
        await this.stage("catalogs", {
          id: cid,
          title: cat.label || cat.name || cat.title || "Каталог",
          kind: "catalog",
        });
        await this.stage("memberships", {
          id: cid + "|" + n.movie.id,
          parentId: cid,
          movieId: n.movie.id,
        });
      }
      if (markSeen)
        await this.stage("history", {
          id: n.movie.id,
          movieId: n.movie.id,
          at: n.movie.addedAt,
          source: "legacy-import",
        });
      const state = raw.userState;
      if (state)
        await this.stage("userState", {
          ...state,
          id: n.movie.id,
          movieId: n.movie.id,
        });
    }
    async record(item) {
      this.stats.records++;
      const { kind, value: v, path: p, context = [] } = item;
      const parent = context[context.length - 1];
      if (["movies", "items", "cards"].includes(kind)) {
        if (!v || typeof v !== "object") return;
        await this.movie(
          v,
          parent ||
            (v.categoryUrl
              ? { url: v.categoryUrl }
              : p.length === 1 && v.entity_type
                ? { id: "catalog:desktop-fav", title: "DESKTOP FAV" }
                : null),
          this.legacy,
        );
        return;
      }
      if (kind === "categories" || kind === "catalogs") {
        if (!v || typeof v !== "object") return;
        const id = categoryId(v, JSON.stringify(p));
        await this.stage("catalogs", {
          id,
          title: v.title || v.name || v.label || v.categoryLabel || "Каталог",
          source: v.baseUrl || v.url || v.source || "",
          kind: /favorites|desktop/.test(id) ? "folder" : "catalog",
        });
        for (const old of [v.id, v.key, v.categoryKey, v.url].filter(Boolean))
          await this.stage("aliases", { id: "parent:" + old, movieId: id });
        return;
      }
      if (["used", "history", "randomHistory"].includes(kind)) {
        const raw = typeof v === "string" ? v : v.movieId || v.url || v.id;
        const id = ref(raw) || raw;
        if (id)
          await this.stage("history", {
            id,
            movieId: id,
            at: v.at || Date.now(),
            source: v.source || "import",
          });
        return;
      }
      if (
        [
          "memberships",
          "collectionItems",
          "movieTags",
          "movieCatalogs",
        ].includes(kind)
      ) {
        const movieId =
          ref(v.movieId || v.itemId || v.sourceHref) || v.movieId || v.itemId;
        const parentId =
          v.parentId ||
          (v.collectionId
            ? "collection:" + v.collectionId
            : v.tagId
              ? "tag:" + v.tagId
              : categoryId(
                  { url: v.categoryKey || v.categoryUrl || v.catalogKey },
                  "source",
                ));
        if (movieId && parentId)
          await this.stage("memberships", {
            id: parentId + "|" + movieId,
            parentId,
            movieId,
          });
        return;
      }
      if (kind === "collections" || kind === "tags") {
        if (v?.id)
          await this.stage(kind, {
            ...v,
            id:
              (kind === "tags" ? "tag:" : "collection:") +
              String(v.id).replace(/^(?:tag:|collection:)/, ""),
          });
        return;
      }
      if (kind === "userState") {
        const id = ref(v.movieId || v.sourceHref || v.id) || v.movieId || v.id;
        if (id) await this.stage("userState", { ...v, id, movieId: id });
        return;
      }
      if (kind === "descriptions" || kind === "details") {
        const id = ref(v.movieId || v.sourceHref || v.id) || v.id;
        if (id)
          await this.stage("details", {
            id,
            description:
              kind === "details"
                ? C.clean(v.description)
                : C.text(v.description || v.bubbleHtml || ""),
            director: v.director || "",
            cast: v.cast || "",
          });
        return;
      }
      if (kind === "posters" || kind === "assets") {
        if (!v) return;
        if (v.id && v.data && v.id.startsWith("image:")) {
          await this.stage("assets", v);
          return;
        }
        const id = ref(v.sourceHref || v.movieId || v.id);
        if (id && v.data) {
          const movie = { id };
          await this.image(movie, v.data);
          await this.stage("movies", { id, posterAsset: movie.posterAsset });
        }
        return;
      }
      if (kind === "aliases" && v?.id) await this.stage("aliases", v);
      if (kind === "tombstones" && v?.id) await this.stage("tombstones", v);
    }
    checkMeta(meta) {
      if (meta.format === "rezka-suite" && meta.schemaVersion !== 1)
        throw Error("Версия базы не поддерживается. Нужна schemaVersion: 1");
      this.legacy = this.legacy || meta.format === "rezkery-randomizer-db";
    }
    parser() {
      const parser = new C.JsonRecords(async (item) => {
        this.checkMeta(parser.stack[0]?.value || parser.metadata || {});
        await this.record(item);
      });
      return parser;
    }
    async json(chunks) {
      const parser = this.parser();
      for await (const chunk of chunks) {
        await parser.feed(chunk);
        if (this.signal?.aborted) throw Error("Импорт отменён");
      }
      await parser.finish();
      this.checkMeta(parser.metadata || {});
      await this.flush();
      return this.finish();
    }
    async html(chunks, base = "https://rezkery.com") {
      let buffer = "",
        capture = "",
        depth = 0,
        kind = "",
        skip = "",
        heading = "",
        headingTag = "",
        current = { id: "catalog:html", title: "Импорт HTML" },
        jsonParser = null;
      const voids = new Set([
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
      ]);
      for await (const chunk of chunks) {
        buffer += chunk;
        let consumed = 0;
        while (consumed < buffer.length) {
          if (skip) {
            const at = buffer.toLowerCase().indexOf("</" + skip, consumed);
            if (at < 0) {
              if (jsonParser)
                await jsonParser.feed(
                  buffer.slice(
                    consumed,
                    Math.max(consumed, buffer.length - skip.length - 4),
                  ),
                );
              consumed = Math.max(consumed, buffer.length - skip.length - 4);
              break;
            }
            if (jsonParser) {
              await jsonParser.feed(buffer.slice(consumed, at));
              await jsonParser.finish();
              this.checkMeta(jsonParser.metadata || {});
              jsonParser = null;
            }
            consumed = at;
            skip = "";
          }
          const lt = buffer.indexOf("<", consumed);
          if (lt < 0) {
            if (depth) capture += buffer.slice(consumed);
            if (headingTag) heading += buffer.slice(consumed);
            consumed = buffer.length;
            break;
          }
          if (depth) capture += buffer.slice(consumed, lt);
          if (headingTag) heading += buffer.slice(consumed, lt);
          let quote = "",
            gt = lt + 1;
          for (; gt < buffer.length; gt++) {
            const c = buffer[gt];
            if (quote) {
              if (c === quote) quote = "";
            } else if (c === '"' || c === "'") quote = c;
            else if (c === ">") break;
          }
          if (gt === buffer.length) {
            consumed = lt;
            break;
          }
          const tag = buffer.slice(lt, gt + 1),
            match = tag.match(/^<\s*(\/?)([\w:-]+)/),
            closing = match?.[1],
            name = match?.[2]?.toLowerCase();
          consumed = gt + 1;
          if (!name) continue;
          if (!depth && !closing && (name === "style" || name === "script")) {
            if (
              name === "script" &&
              /^(?:rezkery-data|rezkery-db|rezka-suite-data)$/.test(
                C.attr(tag, "id"),
              )
            ) {
              jsonParser = this.parser();
            }
            skip = name;
            continue;
          }
          if (!depth && !closing && /^h[12]$/.test(name)) {
            heading = "";
            headingTag = name;
          }
          if (!depth && closing && name === headingTag) {
            const title = C.text(heading) || current.title;
            current = {
              ...current,
              id: "catalog:html:" + C.search(title),
              title,
            };
            headingTag = "";
          }
          if (!depth && !closing && name === "section") {
            const id = C.attr(tag, "id");
            if (id)
              current = {
                id: "html-section:" + id,
                title: C.attr(tag, "data-title") || current.title,
              };
          }
          const classes = C.attr(tag, "class").split(/\s+/);
          const starts =
            !closing &&
            (classes.includes("b-content__inline_item") ||
              classes.includes("movie") ||
              classes.includes("entry") ||
              (classes.includes("card") &&
                ["article", "div", "li"].includes(name)));
          if (!depth && starts) {
            capture = tag;
            depth = 1;
            kind = name;
            continue;
          }
          if (depth) {
            capture += tag;
            if (name === kind) {
              if (closing) depth--;
              else if (!voids.has(name) && !tag.endsWith("/>")) depth++;
            }
            if (!depth) {
              const doc = new DOMParser().parseFromString(
                "<html><body>" + C.inertHtml(capture) + "</body></html>",
                "text/html",
              );
              let parsed = C.parseDocument(doc, base).cards;
              if (!parsed.length) {
                const node = doc.querySelector(".movie,.entry,.card");
                const a =
                  node &&
                  [...node.querySelectorAll("a[href]")].find((a) =>
                    /\/\d+-/.test(a.getAttribute("href") || ""),
                  );
                if (a)
                  parsed = [
                    {
                      url: a.getAttribute("href"),
                      title: C.clean(a.textContent),
                      html: capture,
                      year: node.getAttribute("data-year"),
                      type: node.getAttribute("data-type"),
                    },
                  ];
              }
              for (const raw of parsed) {
                raw.html = raw.html || capture;
                await this.movie(raw, current);
              }
              capture = "";
            }
          }
        }
        buffer = buffer.slice(consumed);
        this.progress({ ...this.stats });
        if (this.signal?.aborted) throw Error("Импорт отменён");
      }
      if (jsonParser) {
        await jsonParser.feed(buffer);
        await jsonParser.finish();
        this.checkMeta(jsonParser.metadata || {});
      }
      if (depth) throw Error("HTML обрезан внутри карточки");
      await this.flush();
      return this.finish();
    }
    async finish() {
      if (!this.stats.movies && !this.stats.records)
        throw Error("В файле не найдена поддерживаемая база");
      const job = {
        id: this.session,
        kind: "import",
        status: "preview",
        stats: this.stats,
        at: Date.now(),
      };
      await this.repo.put("jobs", job);
      return job;
    }
    async apply() {
      await this.flush();
      let key = null,
        applied = 0;
      const order = [
        "tombstones",
        "movies",
        "assets",
        "catalogs",
        "collections",
        "tags",
        "aliases",
        "details",
        "userState",
        "memberships",
        "history",
      ];
      // Two passes resolve old IDs before applying relations. Batches remain bounded.
      for (const store of order) {
        key = null;
        while (true) {
          const records = await this.repo.prefix(
            "staging",
            this.session + ":" + store + ":",
            key,
            100,
          );
          if (!records.length) break;
          const batch = [],
            rows = records.map((e) => ({ ...e.row }));
          if (
            ["memberships", "userState", "history", "details"].includes(store)
          ) {
            const aliases = await this.repo.getMany(
              "aliases",
              rows.map((row) => row.movieId || row.id),
            );
            const parents =
              store === "memberships"
                ? await this.repo.getMany(
                    "aliases",
                    rows.map((row) => "parent:" + row.parentId),
                  )
                : [];
            rows.forEach((row, i) => {
              const original = row.movieId || row.id,
                id = aliases[i]?.movieId || ref(original) || original;
              if (store === "memberships") {
                row.movieId = id;
                if (parents[i]) row.parentId = parents[i].movieId;
                row.id = row.parentId + "|" + id;
              } else {
                row.id = id;
                if (row.movieId) row.movieId = id;
              }
            });
          }
          if (store === "movies")
            for (const row of rows) await C.upgradeIdentity(this.repo, row);
          const existing = await this.repo.getMany(
              store,
              rows.map((x) => x.id),
            ),
            deleted = await this.repo.getMany(
              "tombstones",
              rows.map((x) => store + ":" + x.id),
            );
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i],
              old = existing[i];
            if ((store === "movies" && !row.url && !old) || deleted[i])
              continue;
            let merged = C.merge(old, row);
            if (store === "userState") merged = C.mergeState(old, row);
            batch.push([store, merged]);
            if (store === "assets")
              batch.unshift(["staging", { id: records[i].id }, true]);
            if (store === "memberships") {
              const parent = await this.repo.get("catalogs", row.parentId);
              if (
                /^random$/i.test(
                  (parent?.title || "").replace(/\s*\(\d+\)\s*$/, ""),
                )
              )
                batch.push([
                  "history",
                  {
                    id: row.movieId,
                    movieId: row.movieId,
                    at: Date.now(),
                    source: "RANDOM-import",
                  },
                ]);
            }
            if (store === "tombstones") {
              const s = row.store || row.id.split(":")[0],
                id = row.targetId || row.id.slice(s.length + 1);
              if (
                [
                  "movies",
                  "memberships",
                  "collections",
                  "tags",
                  "userState",
                ].includes(s)
              )
                batch.push([s, { id }, true]);
            }
            if (store === "userState") {
              const m = await this.repo.get("movies", row.id);
              if (m)
                batch.push([
                  "movies",
                  {
                    ...m,
                    status: merged.status || "",
                    rating: merged.rating || 0,
                  },
                ]);
            }
            applied++;
          }
          await this.repo.batch(batch);
          if (root.RezkaSuitePublishSelected) {
            const ids = batch
              .filter((x) => x[0] === "history" && !x[2])
              .map((x) => x[1].movieId || x[1].id);
            if (ids.length) {
              const movies = (await this.repo.getMany("movies", ids)).filter(
                Boolean,
              );
              if (movies.length) await root.RezkaSuitePublishSelected(movies);
            }
          }
          key = records[records.length - 1].id;
          this.progress({ ...this.stats, applied });
        }
      }
      await this.discard(false);
      const job = {
        id: this.session,
        kind: "import",
        status: "completed",
        stats: this.stats,
        applied,
        at: Date.now(),
      };
      await this.repo.put("jobs", job);
      return job;
    }
    async discard(removeJob = true) {
      let key = null;
      while (true) {
        const records = await this.repo.prefix(
          "staging",
          this.session + ":",
          key,
          200,
        );
        if (!records.length) break;
        await this.repo.batch(
          records.map((x) => ["staging", { id: x.id }, true]),
        );
        key = records[records.length - 1].id;
      }
      if (removeJob) await this.repo.delete("jobs", this.session);
    }
    async file(file) {
      if (/\.zip$/i.test(file.name)) {
        const E = root.RezkaSuiteExport,
          entries = await E.zipEntries(file),
          db = entries.find((x) => x.name === "database.json");
        if (!db) throw Error("В ZIP нет database.json");
        await this.json(E.checkedText(db));
        for (const e of entries) {
          if (!e.name.startsWith("assets/")) continue;
          if (e.size > 20 * 1024 * 1024)
            throw Error("Изображение в ZIP больше 20 МБ");
          let s = "";
          for await (const c of E.checkedText(e)) s += c;
          const a = JSON.parse(s);
          if (
            a.id !== "image:" + (await hash(a.data)) ||
            !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(a.data)
          )
            throw Error("Повреждён постер в пакете");
          await this.stage("assets", a);
          this.stats.assets++;
        }
        await this.flush();
        return this.finish();
      }
      if (/\.mhtml?$/i.test(file.name)) {
        if (file.size > 30 * 1024 * 1024)
          throw Error("MHTML больше 30 МБ: сохраните основной HTML отдельно");
        const data = C.mhtml(await file.text());
        return this.html([data.html], data.url || undefined);
      }
      if (/\.json$/i.test(file.name)) return this.json(C.blobText(file));
      return this.html(C.blobText(file));
    }
  }
  root.RezkaSuiteImporter = { Importer, hash, categoryId };
  if (typeof module === "object") module.exports = root.RezkaSuiteImporter;
})(typeof globalThis !== "undefined" ? globalThis : this);
