(function (root, factory) {
  const api = factory();
  if (typeof module === "object") module.exports = api;
  root.RezkaSuite = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const VERSION = 1,
    GENRES = { film: "1", series: "2", cartoon: "3", anime: "82" };
  const stores = [
    "movies",
    "aliases",
    "catalogs",
    "memberships",
    "userState",
    "collections",
    "tags",
    "history",
    "assets",
    "jobs",
    "settings",
    "tombstones",
    "staging",
    "details",
  ];
  const clean = (s) =>
    String(s == null ? "" : s)
      .replace(/\s+/g, " ")
      .trim();
  const search = (s) =>
    clean(s).normalize("NFKC").toLowerCase().replace(/ё/g, "е");
  const escape = (s) =>
    String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function decode(s) {
    return String(s || "").replace(
      /&(?:amp|quot|apos|lt|gt|#39|#x([0-9a-f]+)|#(\d+));/gi,
      (a, x, n) =>
        x
          ? String.fromCodePoint(parseInt(x, 16))
          : n
            ? String.fromCodePoint(+n)
            : {
                "&amp;": "&",
                "&quot;": '"',
                "&apos;": "'",
                "&#39;": "'",
                "&lt;": "<",
                "&gt;": ">",
              }[a] || a,
    );
  }
  function text(html) {
    return clean(
      decode(
        String(html || "")
          .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
          .replace(/<[^>]*>/g, " "),
      ),
    );
  }
  function attr(tag, key) {
    const m = String(tag || "").match(
      new RegExp(
        "(?:^|\\s)" + key + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
        "i",
      ),
    );
    return m ? decode(m[1] ?? m[2] ?? m[3] ?? "") : "";
  }
  function url(value, base = "https://rezkery.com") {
    if (!clean(value)) return "";
    try {
      const u = new URL(decode(value), base);
      return /^https?:$/.test(u.protocol) ? u.href : "";
    } catch {
      return "";
    }
  }
  function path(value) {
    try {
      return (
        new URL(value, "https://rezkery.com").pathname
          .replace(/\/{2,}/g, "/")
          .replace(/\/+$/, "") || "/"
      );
    } catch {
      return "";
    }
  }
  function numericId(raw) {
    const u = raw.url || raw.href || raw.sourceHref || "";
    const m = path(u).match(/\/(\d+)-[^/]+(?:\.html)?$/i);
    if (m) return m[1];
    const n = String(raw.rezkaId || raw.contentKey || raw.id || "").match(
      /^(?:rezka:)?(\d+)$/,
    );
    return n ? n[1] : "";
  }
  function identity(raw) {
    if (typeof raw === "string") raw = { url: raw };
    const id = numericId(raw || {});
    if (id) return "rezka:" + id;
    const p = path(raw?.url || raw?.href || raw?.sourceHref || "");
    return p && p !== "/" ? "path:" + p : "";
  }
  function typeOf(u, t = "") {
    const n = search(t);
    if (/anime|аниме/.test(n) || /\/anime\//.test(u)) return "anime";
    if (/cartoon|мульт/.test(n) || /\/cartoons?\//.test(u)) return "cartoon";
    if (/series|serial|сериал/.test(n) || /\/series\//.test(u)) return "series";
    return "film";
  }
  function year(v) {
    const m = String(v ?? "").match(/\b((?:18|19|20|21)\d{2})\b/);
    return m ? +m[1] : null;
  }
  function list(v) {
    return [
      ...new Set(
        (Array.isArray(v) ? v : String(v || "").split(/[,;]+/))
          .map(clean)
          .filter(Boolean),
      ),
    ];
  }
  function stamp(v, fallback = Date.now()) {
    if (typeof v === "number") return v < 1e11 ? v * 1000 : v;
    const n = Date.parse(v || "");
    return Number.isFinite(n) ? n : fallback;
  }
  function normalize(raw, base) {
    const d = raw.details || {},
      html = raw.html || "";
    const fromHtml =
      attr(html.match(/<[^>]+data-rk-source[^>]*>/i)?.[0], "data-rk-source") ||
      [...html.matchAll(/<a\b[^>]*>/gi)]
        .map((x) => attr(x[0], "href"))
        .find((x) => /\/(?:films?|series|cartoons|anime)\/.*\d+-/.test(x));
    const u = url(
      raw.url ||
        raw.href ||
        raw.sourceHref ||
        raw.link ||
        raw.uri ||
        fromHtml ||
        "",
      base,
    );
    const id = identity({ ...raw, url: u });
    if (!id || !u) return null;
    const picture =
      raw.posterData ||
      raw.poster ||
      raw.posterOriginal ||
      raw.posterUrl ||
      raw.img ||
      raw.cover ||
      attr(html.match(/<img\b[^>]*>/i)?.[0], "src");
    const original =
      raw.originalTitle || d.originalTitle || d.original_title || "";
    const title = clean(raw.title || raw.name || d.title || "Без названия");
    const releaseYear =
      year(raw.year || d.year || d.release) ||
      year(
        (path(u).split("/").pop() || "")
          .replace(/^\d+-/, "")
          .match(/(?:18|19|20|21)\d{2}/g)
          ?.at(-1),
      );
    const movie = {
      id,
      status: raw.status || "",
      rating: Number(raw.rating) || 0,
      rezkaId: numericId({ ...raw, url: u }),
      url: u,
      aliases: [...new Set([...(raw.aliases || []), path(u)])],
      title,
      originalTitle: clean(original),
      year: releaseYear,
      yearKey: releaseYear || 0,
      creditsSearch: clean(
        raw.creditsSearch ||
          [d.director, d.cast, raw.director, raw.cast]
            .filter(Boolean)
            .join(" "),
      ),
      type: typeOf(path(u), raw.type || raw.entity_type || raw.entity || ""),
      countries: list(raw.countries || raw.country || d.country),
      genres: list(raw.genres || raw.genre || d.genre),
      posterUrl: /^data:/.test(picture || "") ? "" : url(picture || "", base),
      posterAsset: raw.posterAsset || "",
      addedAt: stamp(raw.addedAt || raw.date, 0) || Date.now(),
      updatedAt: stamp(raw.updatedAt),
      siteRating: Number(raw.siteRating || d.siteRating || d.rezka) || 0,
      imdb: Number(raw.imdb || d.imdb) || 0,
      kp: Number(raw.kp || d.kp) || 0,
    };
    if (Array.isArray(raw.manual))
      movie.manual = raw.manual.filter((k) =>
        [
          "title",
          "originalTitle",
          "year",
          "type",
          "countries",
          "genres",
          "posterUrl",
          "imdb",
          "kp",
          "siteRating",
        ].includes(k),
      );
    if (
      movie.manual?.includes("year") &&
      (raw.year === null || raw.year === "")
    )
      movie.year = null;
    movie.yearKey = movie.year || 0;
    movie.search = search(
      [
        movie.title,
        movie.originalTitle,
        ...movie.countries,
        ...movie.genres,
        movie.creditsSearch,
      ].join(" "),
    );
    movie.tokens = [
      ...new Set(movie.search.split(/[^\p{L}\p{N}]+/u).filter(Boolean)),
    ];
    const detail = {
      id,
      description: clean(
        typeof d.description === "object"
          ? d.description.text
          : d.description ||
              raw.description?.text ||
              raw.description ||
              text(raw.detailsHtml || d.bubbleHtml || ""),
      ),
      director: clean(d.director || raw.director),
      cast: clean(d.cast || raw.cast),
    };
    return {
      movie,
      detail,
      poster: /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(
        picture || "",
      )
        ? picture
        : "",
    };
  }
  function merge(a, b) {
    if (!a) return b;
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      if (
        v !== null &&
        v !== undefined &&
        v !== "" &&
        v !== 0 &&
        (!Array.isArray(v) || v.length) &&
        !(k === "title" && v === "Без названия" && a.title)
      )
        out[k] = v;
    }
    if (a.addedAt || b.addedAt)
      out.addedAt = Math.min(a.addedAt || Infinity, b.addedAt || Infinity);
    if (a.aliases || b.aliases)
      out.aliases = [...new Set([...(a.aliases || []), ...(b.aliases || [])])];
    if (a.manual) {
      for (const k of a.manual) out[k] = a[k];
      out.manual = a.manual;
    }
    if (out.url) {
      out.yearKey = out.year || 0;
      out.search = search(
        [
          out.title,
          out.originalTitle,
          ...(out.countries || []),
          ...(out.genres || []),
          out.creditsSearch,
        ].join(" "),
      );
      out.tokens = [
        ...new Set(out.search.split(/[^\p{L}\p{N}]+/u).filter(Boolean)),
      ];
    }
    return out;
  }
  function mergeState(a, b) {
    if (!a) return b;
    const first = stamp(a.updatedAt, 0) >= stamp(b.updatedAt, 0) ? a : b,
      second = first === a ? b : a,
      out = { ...second, ...first };
    const variants = [...(a.conflicts || []), ...(b.conflicts || [])];
    if (
      ["note", "rating", "status", "favorite"].some(
        (k) => a[k] !== undefined && b[k] !== undefined && a[k] !== b[k],
      )
    )
      variants.push({
        note: second.note || "",
        rating: second.rating || 0,
        status: second.status || "",
        favorite: !!second.favorite,
        updatedAt: second.updatedAt || 0,
      });
    if (variants.length)
      out.conflicts = [
        ...new Map(variants.map((x) => [JSON.stringify(x), x])).values(),
      ];
    return out;
  }
  function legacyItem(m) {
    return {
      id: path(m.url),
      url: m.url,
      title: m.title,
      year: m.year,
      type: m.type,
      poster: m.posterUrl || "",
      addedAt: m.addedAt,
    };
  }
  function inertHtml(html) {
    return String(html || "")
      .replace(
        /<(script|style|iframe|object|svg|video|audio)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
        "",
      )
      .replace(
        /<\/?(?:link|iframe|object|embed|source|video|audio)\b[^>]*>/gi,
        "",
      )
      .replace(/<img\b[^>]*>/gi, (tag) => {
        const src = attr(tag, "data-src") || attr(tag, "src");
        return tag
          .replace(
            /\s(?:src|srcset|data-src|data-srcset)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
            "",
          )
          .replace(/\s*\/?>$/, ' data-suite-src="' + escape(src) + '">');
      })
      .replace(/\s(?:style|on[a-z]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  }
  async function upgradeIdentity(repo, movie) {
    if (!movie.id.startsWith("rezka:")) return;
    for (const p of movie.aliases || []) {
      if (identity({ url: p }) === movie.id) continue;
      const alias = await repo.get("aliases", p),
        oldId = alias?.movieId || "path:" + p;
      if (!oldId.startsWith("path:")) continue;
      const old = await repo.get("movies", oldId);
      if (!old) continue;
      const rows = [
        ["movies", { ...merge(old, movie), id: movie.id }],
        ["movies", { id: oldId }, true],
      ];
      for (const store of ["details", "userState", "history"]) {
        const item = await repo.get(store, oldId);
        if (item) {
          rows.push(
            [
              store,
              {
                ...(store === "userState"
                  ? mergeState(item, (await repo.get(store, movie.id)) || {})
                  : merge(item, (await repo.get(store, movie.id)) || {})),
                id: movie.id,
                ...(store === "details" ? {} : { movieId: movie.id }),
              },
            ],
            [store, { id: oldId }, true],
          );
        }
      }
      for (const relation of await repo.links(oldId))
        rows.push(
          [
            "memberships",
            {
              ...relation,
              id: relation.parentId + "|" + movie.id,
              movieId: movie.id,
            },
          ],
          ["memberships", { id: relation.id }, true],
        );
      for (const a of [oldId, old.url, ...(old.aliases || [])])
        if (a) rows.push(["aliases", { id: a, movieId: movie.id }]);
      await repo.batch(rows);
    }
  }
  function scope(input) {
    const u = new URL(input);
    u.hash = "";
    u.pathname = u.pathname.replace(/\/page\/\d+\/?$/i, "/");
    u.searchParams.delete("page");
    u.searchParams.sort();
    return {
      origin: u.origin,
      pathname: u.pathname.replace(/\/+$/, "") || "/",
      query: u.searchParams.toString(),
      key:
        (u.pathname.replace(/\/+$/, "") || "/") +
        (u.searchParams.toString() ? "?" + u.searchParams.toString() : ""),
    };
  }
  function pageUrl(base, n) {
    const u = new URL(base);
    u.pathname =
      u.pathname.replace(/\/page\/\d+\/?$/i, "/").replace(/\/+$/, "") +
      (n > 1 ? "/page/" + n + "/" : "/");
    u.searchParams.delete("page");
    return u.href;
  }
  function catalogUrl(origin, kind = "all", y = "") {
    const u = new URL(origin);
    u.pathname = y ? "/year/" + y + "/" : "/";
    u.search = "";
    u.hash = "";
    if (GENRES[kind]) {
      u.searchParams.set("filter", "last");
      u.searchParams.set("genre", GENRES[kind]);
    }
    return u.href;
  }
  function pagination(doc, current) {
    const requested = scope(current);
    let max = 1,
      exact = false;
    const currentPage = Number(
      path(current).match(/\/page\/(\d+)$/)?.[1] ||
        new URL(current).searchParams.get("page") ||
        1,
    );
    max = currentPage;
    const nav = doc.querySelectorAll(
      '.b-navigation,.pagination,[class~="navigation"]',
    );
    for (const box of nav)
      for (const el of box.querySelectorAll("a,span,[data-page]")) {
        const href =
          el.getAttribute("href") ||
          el.getAttribute("data-href") ||
          el.getAttribute("data-url");
        if (href) {
          const abs = url(href, current);
          if (!abs || scope(abs).key !== requested.key) continue;
          const n = Number(
            path(abs).match(/\/page\/(\d+)$/)?.[1] ||
              new URL(abs).searchParams.get("page") ||
              1,
          );
          max = Math.max(max, n);
          exact = true;
        } else {
          const n = Number(
            clean(el.textContent) || el.getAttribute("data-page"),
          );
          if (n > 0 && n < 100000) max = Math.max(max, n);
        }
      }
    return {
      max,
      exact: exact || (!nav.length && max === 1),
      current: currentPage,
      scope: requested.key,
    };
  }
  function challenge(doc) {
    const s = (
      doc.title +
      " " +
      (doc.body?.textContent || "").slice(0, 30000)
    ).toLowerCase();
    return (
      /just a moment|verify you are human|checking your browser|making sure you.{0,8}not a bot|проверка браузера/.test(
        s,
      ) ||
      !!doc.querySelector(
        '#challenge-running, #anubis_challenge, #challenge-form, [data-anubis], script[src*="challenge-platform"]',
      )
    );
  }
  function parseDocument(doc, source) {
    if (challenge(doc)) return { challenge: true, cards: [], folders: [] };
    const cards = [];
    const seen = new Set();
    let nodes = doc.querySelectorAll(
      ".b-content__inline_item,article.movie,div.movie,article.card,article.entry,.grid > .card,.list > .entry",
    );
    if (!nodes.length) nodes = doc.querySelectorAll("[data-rk-source]");
    for (const node of nodes) {
      const a =
        node.querySelector(
          ".b-content__inline_item-link > a,.movieTitle a,a.movie-title,a.title,.title a",
        ) ||
        [...node.querySelectorAll("a[href]")].find((x) =>
          /\/\d+-/.test(x.getAttribute("href") || ""),
        );
      if (!a) continue;
      const image = node.querySelector("img");
      const meta = node.querySelector(
        ".b-content__inline_item-link > div,.meta,.details",
      );
      const raw = {
        id: node.getAttribute("data-id"),
        url: node.getAttribute("data-rk-source") || a.getAttribute("href"),
        title: clean(a.textContent),
        year:
          node.getAttribute("data-year") ||
          node.getAttribute("data-rk-year") ||
          year(meta?.textContent),
        type:
          node.getAttribute("data-type") ||
          node.getAttribute("data-rk-type") ||
          node.querySelector(".entity")?.textContent,
        poster:
          image &&
          (image.getAttribute("data-suite-src") ||
            image.getAttribute("data-src") ||
            image.getAttribute("src")),
        description: node.querySelector(
          ".descriptionInner,.description,.b-content__bubble_text",
        )?.textContent,
        country: node.getAttribute("data-rk-country"),
        genre: node.getAttribute("data-rk-genre"),
      };
      const normalized = normalize(raw, source);
      if (normalized && !seen.has(normalized.movie.id)) {
        seen.add(normalized.movie.id);
        cards.push(raw);
      }
    }
    const folders = [
      ...doc.querySelectorAll("a.b-favorites_content__cats_list_link"),
    ]
      .map((a) => ({
        id:
          a.getAttribute("data-id") ||
          path(url(a.getAttribute("href"), source)).match(
            /\/favorites\/(\d+)/,
          )?.[1],
        name: clean(
          a.querySelector(".name")?.textContent || a.textContent,
        ).replace(/\s*\(\d+\)$/, ""),
        url: url(a.getAttribute("href"), source),
      }))
      .filter((f) => f.id && f.url);
    return {
      cards,
      folders,
      pagination: pagination(doc, source),
      title: clean(doc.querySelector("h1")?.textContent || doc.title),
      signature: cards
        .map((x) => identity({ ...x, url: url(x.url, source) }))
        .sort()
        .join("|"),
      url: source,
    };
  }
  // Incremental JSON tokenizer. Completed collection members are detached immediately;
  // a 245 MB project never becomes one JavaScript string or category object.
  class JsonRecords {
    constructor(onRecord) {
      this.onRecord = onRecord;
      this.stack = [];
      this.mode = "value";
      this.token = "";
      this.tokenParts = [];
      this.escape = false;
      this.rootDone = false;
      this.pending = [];
      this.values = 0;
    }
    recordKind(p) {
      if (!p.length) return "";
      if (p.length === 1 && typeof p[0] === "number") return "items";
      const collection = String(p[p.length - 2] || "");
      const prefix = p.slice(0, -2);
      const top = prefix.every((k) =>
        ["data", "db", "payload", "database"].includes(k),
      );
      const nested =
        ["cards", "items", "movies"].includes(collection) &&
        prefix.length >= 2 &&
        ["categories", "catalogs"].includes(prefix[prefix.length - 2]);
      if (
        (top || nested) &&
        [
          "movies",
          "items",
          "cards",
          "categories",
          "catalogs",
          "memberships",
          "posters",
          "descriptions",
          "details",
          "userState",
          "collections",
          "collectionItems",
          "tags",
          "movieTags",
          "movieCatalogs",
          "used",
          "history",
          "randomHistory",
          "assets",
          "aliases",
          "tombstones",
        ].includes(collection)
      )
        return collection;
      return "";
    }
    valuePath() {
      const f = this.stack[this.stack.length - 1];
      return f ? f.path.concat(f.type === "array" ? f.index : f.key) : [];
    }
    attach(v, p) {
      const parent = this.stack[this.stack.length - 1];
      const kind = this.recordKind(p);
      if (kind) {
        const context = this.stack
          .filter(
            (f) =>
              this.recordKind(f.path) === "categories" ||
              this.recordKind(f.path) === "catalogs",
          )
          .map((f) => ({ token: JSON.stringify(f.path), ...f.value }));
        this.pending.push({ kind, value: v, path: p, context });
      } else if (parent) {
        if (parent.type === "array") parent.value.push(v);
        else parent.value[parent.key] = v;
      }
      if (parent) {
        if (parent.type === "array") {
          parent.index++;
          parent.state = "comma";
        } else {
          parent.key = null;
          parent.state = "comma";
        }
      } else {
        if (this.rootDone) throw Error("Несколько корневых JSON-значений");
        this.rootDone = true;
        this.metadata = v;
      }
      this.values++;
    }
    tokenDone() {
      let v;
      if (this.mode === "string")
        v = JSON.parse('"' + this.tokenParts.join("") + '"');
      else {
        if (
          !/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(
            this.token,
          )
        )
          throw Error("Некорректное JSON-значение");
        v = JSON.parse(this.token);
      }
      const top = this.stack[this.stack.length - 1];
      if (
        top?.type === "object" &&
        (top.state === "key" || top.state === "keyRequired")
      ) {
        if (this.mode !== "string") throw Error("Ожидается JSON-ключ");
        top.key = v;
        top.state = "colon";
      } else this.attach(v, this.valuePath());
      this.mode = "value";
      this.token = "";
      this.tokenParts = [];
    }
    async feed(chunk) {
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];
        if (this.mode === "string") {
          let j = i;
          for (; j < chunk.length; j++) {
            const ch = chunk[j];
            if (ch === '"' && !this.escape) break;
            if (this.escape) this.escape = false;
            else if (ch === "\\") this.escape = true;
          }
          this.tokenParts.push(chunk.slice(i, j));
          if (j < chunk.length) this.tokenDone();
          i = j;
          continue;
        }
        if (this.mode === "primitive") {
          if (/[\s,}\]]/.test(c)) {
            this.tokenDone();
            i--;
          } else this.token += c;
          continue;
        }
        if (/\s/.test(c)) continue;
        const f = this.stack[this.stack.length - 1];
        if (c === ":" && f?.state === "colon") {
          f.state = "value";
          continue;
        }
        if (c === "," && f?.state === "comma") {
          f.state = f.type === "object" ? "keyRequired" : "valueRequired";
          continue;
        }
        if (c === "}" || c === "]") {
          if (
            !f ||
            f.type !== (c === "}" ? "object" : "array") ||
            !["key", "value", "comma"].includes(f.state)
          )
            throw Error("Незавершённый JSON-контейнер");
          this.stack.pop();
          this.attach(f.value, f.path);
          continue;
        }
        if (
          f &&
          !["key", "keyRequired", "value", "valueRequired"].includes(f.state)
        )
          throw Error("Ожидается разделитель JSON");
        if (c === "{" || c === "[") {
          if (f?.type === "object" && ["key", "keyRequired"].includes(f.state))
            throw Error("Ожидается имя поля");
          this.stack.push({
            type: c === "{" ? "object" : "array",
            value: c === "{" ? Object.create(null) : [],
            path: this.valuePath(),
            index: 0,
            key: null,
            state: c === "{" ? "key" : "value",
          });
          continue;
        }
        if (c === '"') {
          this.mode = "string";
          this.token = "";
          this.tokenParts = [];
          this.escape = false;
          continue;
        }
        if (f?.type === "object" && ["key", "keyRequired"].includes(f.state))
          throw Error("Ожидается имя поля");
        this.mode = "primitive";
        this.token = c;
      }
      for (const item of this.pending.splice(0)) await this.onRecord(item);
    }
    async finish() {
      if (this.mode === "primitive") this.tokenDone();
      if (this.mode !== "value" || this.stack.length || !this.rootDone)
        throw Error("Файл JSON обрезан или повреждён");
      for (const item of this.pending.splice(0)) await this.onRecord(item);
    }
  }
  async function* blobText(blob, size = 262144) {
    const decoder = new TextDecoder();
    for (let p = 0; p < blob.size; p += size) {
      const b = await blob.slice(p, p + size).arrayBuffer();
      yield decoder.decode(b, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  }
  function mhtml(text) {
    const boundary = text.match(/boundary="?([^"\r\n;]+)/i)?.[1];
    if (!boundary) throw Error("Не найден MIME boundary");
    for (const part of text.split("--" + boundary)) {
      const split = part.search(/\r?\n\r?\n/);
      if (
        split < 0 ||
        !/^content-type:\s*text\/html/im.test(part.slice(0, split))
      )
        continue;
      const header = part.slice(0, split),
        body = part.slice(split).trim();
      let bytes;
      if (/base64/i.test(header))
        bytes = Uint8Array.from(atob(body.replace(/\s/g, "")), (c) =>
          c.charCodeAt(0),
        );
      else if (/quoted-printable/i.test(header)) {
        const encoded = body.replace(/=\r?\n/g, "");
        const out = [];
        for (let i = 0; i < encoded.length; i++) {
          if (
            encoded[i] === "=" &&
            /^[a-f0-9]{2}$/i.test(encoded.slice(i + 1, i + 3))
          ) {
            out.push(parseInt(encoded.slice(i + 1, i + 3), 16));
            i += 2;
          } else out.push(encoded.charCodeAt(i));
        }
        bytes = new Uint8Array(out);
      } else bytes = new TextEncoder().encode(body);
      return {
        html: new TextDecoder(
          header.match(/charset="?([^";\s]+)/i)?.[1] || "utf-8",
        ).decode(bytes),
        url: header.match(/Content-Location:\s*(.+)/i)?.[1]?.trim() || "",
      };
    }
    throw Error("HTML-часть MHTML не найдена");
  }
  return {
    VERSION,
    stores,
    GENRES,
    clean,
    search,
    escape,
    decode,
    text,
    attr,
    url,
    path,
    numericId,
    identity,
    typeOf,
    year,
    list,
    stamp,
    normalize,
    merge,
    mergeState,
    legacyItem,
    inertHtml,
    upgradeIdentity,
    scope,
    pageUrl,
    catalogUrl,
    pagination,
    challenge,
    parseDocument,
    JsonRecords,
    blobText,
    mhtml,
  };
});
