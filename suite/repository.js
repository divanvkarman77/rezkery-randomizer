(function (root) {
  "use strict";
  const C = root.RezkaSuite;
  class Repository {
    constructor(name = "rezka-suite-v1") {
      this.name = name;
      this.db = null;
    }
    async open() {
      if (this.db) return this;
      this.db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(this.name, 3);
        r.onupgradeneeded = () => {
          for (const name of C.stores) {
            const db = r.result,
              s = db.objectStoreNames.contains(name)
                ? r.transaction.objectStore(name)
                : db.createObjectStore(name, { keyPath: "id" });
            if (name === "movies") {
              for (const k of [
                "title",
                "year",
                "type",
                "addedAt",
                "updatedAt",
                "siteRating",
                "rating",
              ]) {
                const field = k === "year" ? "yearKey" : k;
                if (s.indexNames.contains(k) && s.index(k).keyPath !== field)
                  s.deleteIndex(k);
                if (!s.indexNames.contains(k)) s.createIndex(k, field);
              }
              if (!s.indexNames.contains("tokens"))
                s.createIndex("tokens", "tokens", { multiEntry: true });
              for (const field of ["year", "type"])
                for (const sort of [
                  "title",
                  "year",
                  "addedAt",
                  "siteRating",
                  "rating",
                ]) {
                  const key = field + "|" + sort;
                  const fields = [
                    field === "year" ? "yearKey" : field,
                    sort === "year" ? "yearKey" : sort,
                  ];
                  if (
                    s.indexNames.contains(key) &&
                    JSON.stringify(s.index(key).keyPath) !==
                      JSON.stringify(fields)
                  )
                    s.deleteIndex(key);
                  if (!s.indexNames.contains(key)) s.createIndex(key, fields);
                }
              const cursor = s.openCursor();
              cursor.onsuccess = () => {
                const c = cursor.result;
                if (c) {
                  const m = c.value;
                  m.yearKey = m.year || 0;
                  m.rating = Number(m.rating) || 0;
                  m.siteRating = Number(m.siteRating) || 0;
                  c.update(m);
                  c.continue();
                }
              };
            }
            if (name === "memberships") {
              for (const key of ["parentId", "movieId"])
                if (!s.indexNames.contains(key)) s.createIndex(key, key);
            }
            if (name === "staging" && !s.indexNames.contains("session"))
              s.createIndex("session", "session");
          }
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.onblocked = () =>
          reject(Error("Закройте другие окна библиотеки для обновления базы"));
      });
      this.db.onversionchange = () => this.close();
      return this;
    }
    async get(store, id) {
      await this.open();
      return new Promise((resolve, reject) => {
        const r = this.db.transaction(store).objectStore(store).get(id);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    async getMany(store, ids) {
      await this.open();
      return new Promise((resolve, reject) => {
        const out = [];
        const tx = this.db.transaction(store);
        ids.forEach((id, i) => {
          const r = tx.objectStore(store).get(id);
          r.onsuccess = () => {
            out[i] = r.result;
          };
        });
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
      });
    }
    async prefix(store, prefix, after = null, limit = 100) {
      await this.open();
      return new Promise((resolve, reject) => {
        const out = [],
          range = IDBKeyRange.bound(
            after || prefix,
            prefix + "\uffff",
            !!after,
            false,
          );
        const r = this.db
          .transaction(store)
          .objectStore(store)
          .openCursor(range);
        r.onsuccess = () => {
          const c = r.result;
          if (!c || out.length >= limit) return resolve(out);
          out.push(c.value);
          c.continue();
        };
        r.onerror = () => reject(r.error);
      });
    }
    async batch(rows) {
      if (!rows.length) return;
      await this.open();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(
          [...new Set(rows.map((x) => x[0]))],
          "readwrite",
        );
        for (const [store, row, remove] of rows) {
          const s = tx.objectStore(store);
          if (remove) s.delete(row.id);
          else s.put(row);
        }
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () =>
          reject(tx.error || Error("Транзакция базы прервана"));
      });
    }
    put(store, row) {
      return this.batch([[store, row]]);
    }
    delete(store, id) {
      return this.batch([[store, { id }, true]]);
    }
    async count(store) {
      await this.open();
      return new Promise((resolve, reject) => {
        const r = this.db.transaction(store).objectStore(store).count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    async page(store, after = null, limit = 100) {
      await this.open();
      return new Promise((resolve, reject) => {
        const out = [];
        const r = this.db
          .transaction(store)
          .objectStore(store)
          .openCursor(
            after === null ? undefined : IDBKeyRange.lowerBound(after, true),
          );
        r.onsuccess = () => {
          const c = r.result;
          if (!c || out.length >= limit) return resolve(out);
          out.push(c.value);
          c.continue();
        };
        r.onerror = () => reject(r.error);
      });
    }
    async *iterate(store) {
      let key = null;
      while (true) {
        const rows = await this.page(store, key, 100);
        if (!rows.length) return;
        for (const row of rows) yield row;
        key = rows[rows.length - 1].id;
      }
    }
    async all(store) {
      const out = [];
      for await (const row of this.iterate(store)) out.push(row);
      return out;
    }
    async children(parentId) {
      await this.open();
      return new Promise((resolve, reject) => {
        const r = this.db
          .transaction("memberships")
          .objectStore("memberships")
          .index("parentId")
          .getAll(parentId);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    async links(movieId) {
      await this.open();
      return new Promise((resolve, reject) => {
        const r = this.db
          .transaction("memberships")
          .objectStore("memberships")
          .index("movieId")
          .getAll(movieId);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    }
    async query(f = {}) {
      await this.open();
      let allowed = null;
      if (f.parent) {
        allowed = new Set(
          (await this.children(f.parent)).map((x) => x.movieId),
        );
      }
      const words = C.search(f.q).split(/\s+/).filter(Boolean);
      const sort = [
          "title",
          "year",
          "siteRating",
          "rating",
          "addedAt",
        ].includes(f.sort)
          ? f.sort
          : "addedAt",
        field = f.year ? "year" : f.type ? "type" : "",
        value = f.year ? Number(f.year) : f.type;
      const name = field ? field + "|" + sort : words.length ? "tokens" : sort;
      const range = field
        ? IDBKeyRange.bound([value], [value, []])
        : words.length
          ? IDBKeyRange.bound(words[0], words[0] + "\uffff")
          : null;
      return new Promise((resolve, reject) => {
        const out = [],
          visited = new Set();
        let skipped = 0;
        const tx = this.db.transaction("movies");
        const r = tx
          .objectStore("movies")
          .index(name)
          .openCursor(
            range || undefined,
            sort === "title" || name === "tokens" ? "next" : "prev",
          );
        r.onsuccess = () => {
          const c = r.result;
          if (!c) return resolve({ items: out, hasMore: false });
          const m = c.value;
          const matches =
            !visited.has(m.id) &&
            (!f.year || m.year === Number(f.year)) &&
            (!f.type || m.type === f.type) &&
            (!f.status || m.status === f.status) &&
            (!allowed || allowed.has(m.id)) &&
            words.every((w) => (m.search || C.search(m.title)).includes(w));
          visited.add(m.id);
          if (matches) {
            if (skipped++ >= Number(f.offset || 0)) {
              if (out.length >= Number(f.limit || 60))
                return resolve({ items: out, hasMore: true });
              out.push(m);
            }
          }
          c.continue();
        };
        r.onerror = () => reject(r.error);
      });
    }
    close() {
      this.db?.close();
      this.db = null;
    }
  }
  class NativeRepository {
    async command(op, args = {}) {
      const response = JSON.parse(
        root.RezkaNative.database(JSON.stringify({ op, ...args })),
      );
      if (response.error) throw Error(response.error);
      return response.value;
    }
    open() {
      return Promise.resolve(this);
    }
    get(store, id) {
      return this.command("get", { store, id });
    }
    batch(rows) {
      return this.command("batch", { rows });
    }
    put(store, row) {
      return this.batch([[store, row]]);
    }
    delete(store, id) {
      return this.batch([[store, { id }, true]]);
    }
    count(store) {
      return this.command("count", { store });
    }
    page(store, after = null, limit = 100) {
      return this.command("page", { store, after, limit });
    }
    children(parentId) {
      return this.command("children", { parentId });
    }
    query(filters) {
      return this.command("query", { filters });
    }
    async *iterate(store) {
      let key = null;
      while (true) {
        const rows = await this.page(store, key);
        if (!rows.length) return;
        for (const row of rows) yield row;
        key = rows[rows.length - 1].id;
      }
    }
    getMany(store, ids) {
      return this.command("getMany", { store, ids });
    }
    prefix(store, prefix, after = null, limit = 100) {
      return this.command("prefix", { store, prefix, after, limit });
    }
    links(movieId) {
      return this.command("links", { movieId });
    }
    async all(store) {
      const out = [];
      for await (const row of this.iterate(store)) out.push(row);
      return out;
    }
    close() {}
  }
  root.RezkaSuiteRepository = { Repository, NativeRepository };
  if (typeof module === "object") module.exports = root.RezkaSuiteRepository;
})(typeof globalThis !== "undefined" ? globalThis : this);
