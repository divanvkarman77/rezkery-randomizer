(function (root) {
  "use strict";
  const C = root.RezkaSuite;
  class Paused extends Error {
    constructor(message, status = "waiting_challenge", retryAt = 0) {
      super(message);
      this.status = status;
      this.retryAt = retryAt;
    }
  }
  class Runner {
    constructor(
      repo,
      transport,
      {
        now = () => Date.now(),
        sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
      } = {},
    ) {
      this.repo = repo;
      this.transport = transport;
      this.now = now;
      this.sleep = sleep;
      this.busy = false;
    }
    async enqueue(kind, params) {
      const id =
          "job-" + this.now() + "-" + Math.random().toString(36).slice(2),
        u = new URL(params.url);
      if (u.protocol !== "https:")
        throw Error("Используйте HTTPS-адрес зеркала");
      const job = {
        id,
        kind,
        params: { ...params, url: u.href },
        status: "queued",
        phase: "start",
        done: 0,
        imported: 0,
        next: 1,
        at: this.now(),
      };
      await this.repo.put("jobs", job);
      return job;
    }
    async rate() {
      const s = (await this.repo.get("settings", "network")) || {},
        pause = await this.repo.get("settings", "networkPause");
      if (pause?.active) throw new Paused(pause.reason);
      const interval = Math.max(1000, Number(s.interval) || 2000),
        last = (await this.repo.get("settings", "lastRequest"))?.at || 0;
      const left = last + interval - this.now();
      if (left > 0) await this.sleep(left);
      await this.repo.put("settings", { id: "lastRequest", at: this.now() });
    }
    async request(job, command) {
      await this.rate();
      const r = await this.transport(job, command);
      if (r.challenge) {
        await this.repo.put("settings", {
          id: "networkPause",
          active: true,
          reason:
            "Сайт показал проверку защиты. Откройте зеркало, пройдите проверку и нажмите «Продолжить».",
          url: command.url || job.params.url,
        });
        throw new Paused("Запросы остановлены: проверка защиты");
      }
      if (r.retryAfter) {
        const sec = Number(r.retryAfter),
          at = Number.isFinite(sec)
            ? this.now() + sec * 1000
            : Date.parse(r.retryAfter);
        throw new Paused(
          r.error,
          "waiting_retry",
          Number.isFinite(at) ? at : this.now() + 60000,
        );
      }
      if (r.error) throw Error(r.error);
      return r;
    }
    async ingest(cards, parent, history = false) {
      const rows = [],
        normalized = cards
          .map((x) => C.normalize(x, parent?.source))
          .filter(Boolean);
      for (const n of normalized) await C.upgradeIdentity(this.repo, n.movie);
      const existing = await this.repo.getMany(
        "movies",
        normalized.map((x) => x.movie.id),
      );
      for (let i = 0; i < normalized.length; i++) {
        const n = normalized[i];
        rows.push(["movies", C.merge(existing[i], n.movie)]);
        if (n.detail.description) rows.push(["details", n.detail]);
        for (const alias of n.movie.aliases)
          rows.push(["aliases", { id: alias, movieId: n.movie.id }]);
        if (parent)
          rows.push([
            "memberships",
            {
              id: parent.id + "|" + n.movie.id,
              parentId: parent.id,
              movieId: n.movie.id,
            },
          ]);
        if (history)
          rows.push([
            "history",
            {
              id: n.movie.id,
              movieId: n.movie.id,
              at: this.now(),
              source: "RANDOM",
            },
          ]);
      }
      if (parent) rows.push(["catalogs", parent]);
      await this.repo.batch(rows);
      return normalized.length;
    }
    checkPage(job, r, n, base) {
      if (
        C.scope(r.url).key !== C.scope(base).key ||
        r.pagination?.current !== n
      )
        throw Error("Сайт открыл другой адрес вместо страницы " + n);
      let hash = 2166136261;
      for (const c of r.signature || "")
        hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
      const key = C.scope(base).key + ":" + (hash >>> 0);
      job.signatures = job.signatures || {};
      if (r.signature && job.signatures[key] && job.signatures[key] !== n)
        throw Error("Сайт повторил уже полученную страницу. Сбор остановлен");
      if (r.signature) job.signatures[key] = n;
    }
    async step(job) {
      const p = job.params;
      if (job.kind === "scan") {
        const r = await this.request(job, {
          op: "capture",
          url: C.pageUrl(p.url, job.next),
        });
        this.checkPage(job, r, job.next, p.url);
        if (!r.cards.length)
          throw Error("На странице нет карточек; проверьте адрес и вход");
        if (job.next === 1) {
          job.max = Number(p.max) || r.pagination?.max || 1;
          if (!p.max && !r.pagination?.exact)
            throw Error(
              "Последняя страница неизвестна. Укажите число страниц вручную",
            );
          await this.repo.put("settings", {
            id: "pages:" + C.scope(p.url).key,
            max: job.max,
            source: p.max ? "manual" : "site",
            at: this.now(),
          });
        }
        job.imported += await this.ingest(r.cards, {
          id: "catalog:" + C.scope(p.url).key,
          title: p.title || r.title,
          source: p.url,
          kind: "catalog",
        });
        job.done = job.next;
        job.next++;
        if (job.next > job.max) job.status = "completed";
      } else if (job.kind === "bookmarks") {
        if (job.phase === "start") {
          const r = await this.request(job, {
            op: "capture",
            url: new URL("/favorites/", p.url).href,
          });
          if (r.login || !r.folders?.length)
            throw new Paused(
              "Нужен вход в HDRezka на выбранном зеркале",
              "paused_auth",
            );
          job.folders =
            p.direction === "import"
              ? r.folders
              : r.folders.filter((f) => /^random$/i.test(f.name));
          if (!job.folders.length) {
            if (p.direction === "random-import") {
              job.status = "completed";
              return;
            }
            job.phase = "create";
            return;
          }
          job.folder = 0;
          job.phase = "read";
          job.next = 1;
        } else if (job.phase === "create") {
          const r = await this.request(job, {
            op: "post",
            url: new URL("/ajax/favorites/", p.url).href,
            data: { action: "add_cat", name: "RANDOM" },
          });
          const id = r.data?.id || r.data?.cat_id || r.data?.data?.id;
          if (!id) {
            job.phase = "start";
            throw new Paused(
              "Папка создана; обновите список и продолжите",
              "paused_user",
            );
          }
          job.folders = [
            {
              id: String(id),
              name: "RANDOM",
              url: new URL("/favorites/" + id + "/", p.url).href,
            },
          ];
          job.folder = 0;
          job.next = 1;
          job.phase = "read";
        } else if (job.phase === "read") {
          const f = job.folders[job.folder],
            r = await this.request(job, {
              op: "capture",
              url: C.pageUrl(f.url, job.next),
            });
          this.checkPage(job, r, job.next, f.url);
          const parent = {
            id: "catalog:" + C.path(f.url),
            title: f.name,
            source: f.url,
            kind: "folder",
            remoteId: f.id,
          };
          job.imported += await this.ingest(
            r.cards,
            parent,
            /^random$/i.test(f.name),
          );
          job.max = r.pagination?.max || 1;
          job.done++;
          job.next++;
          if (job.next > job.max) {
            job.folder++;
            job.next = 1;
            job.previousSignature = "";
            if (job.folder >= job.folders.length) {
              if (p.direction === "import" || p.direction === "random-import")
                job.status = "completed";
              else {
                job.phase = "upload";
                job.cursor = null;
                job.uploaded = 0;
              }
            }
          }
        } else if (job.phase === "upload") {
          const f = job.folders[0],
            source = p.parent ? "memberships" : "history",
            rows = await this.repo.page(source, job.cursor || null, 30);
          if (!rows.length) {
            job.status = "completed";
            return;
          }
          for (const row of rows) {
            if (p.parent && row.parentId !== p.parent) {
              job.cursor = row.id;
              continue;
            }
            const id = row.movieId || row.id,
              number = id.match(/^rezka:(\d+)$/)?.[1];
            if (!number) {
              job.cursor = row.id;
              continue;
            }
            const parentId = "catalog:" + C.path(f.url),
              member = parentId + "|" + id;
            if (!(await this.repo.get("memberships", member))) {
              await this.request(job, {
                op: "post",
                url: new URL("/ajax/favorites/", p.url).href,
                data: { action: "add_post", post_id: number, cat_id: f.id },
              });
              await this.repo.put("memberships", {
                id: member,
                parentId,
                movieId: id,
              });
              job.uploaded++;
              job.cursor = row.id;
              break;
            }
            job.cursor = row.id;
          }
        }
      } else if (job.kind === "details") {
        const rows = await this.repo.page("movies", job.cursor || null, 1);
        if (!rows.length) {
          job.status = "completed";
          return;
        }
        const m = rows[0];
        if (m.rezkaId) {
          const r = await this.request(job, {
            op: "post",
            url: new URL("/engine/ajax/quick_content.php", p.url).href,
            data: { id: m.rezkaId, is_touch: "1" },
          });
          if (r.detail)
            await this.repo.put(
              "details",
              C.merge(await this.repo.get("details", m.id), {
                id: m.id,
                ...r.detail,
              }),
            );
        }
        job.cursor = m.id;
        job.done++;
      } else if (job.kind === "posters") {
        const rows = await this.repo.page("movies", job.cursor || null, 1);
        if (!rows.length) {
          job.status = "completed";
          return;
        }
        const m = rows[0];
        if (
          m.posterUrl &&
          (!m.posterAsset || !(await this.repo.get("assets", m.posterAsset)))
        ) {
          const r = await this.request(job, { op: "image", url: m.posterUrl });
          if (r.data) {
            const id = "image:" + (await root.RezkaSuiteImporter.hash(r.data));
            const bytes = Math.round(r.data.length * 0.75),
              s = (await this.repo.get("settings", "mediaBytes")) || {
                id: "mediaBytes",
                bytes: 0,
              };
            if (s.bytes + bytes > 512 * 1024 * 1024)
              throw new Paused(
                "Кэш достиг 512 МБ. Очистите медиа перед продолжением",
                "paused_user",
              );
            await this.repo.batch([
              ["assets", { id, data: r.data, bytes, movieId: m.id }],
              ["movies", { ...m, posterAsset: id }],
              ["settings", { ...s, bytes: s.bytes + bytes }],
            ]);
          }
        }
        job.cursor = m.id;
        job.done++;
      } else throw Error("Неизвестное задание");
    }
    async tick() {
      if (this.busy) return;
      this.busy = true;
      try {
        const jobs = await this.repo.all("jobs");
        let job = jobs.find(
          (x) =>
            ["queued", "running"].includes(x.status) ||
            (x.status === "waiting_retry" && x.retryAt <= this.now()),
        );
        if (!job) return;
        job.status = "running";
        try {
          await this.step(job);
          job.at = this.now();
          job.attempts = 0;
          job.error = "";
        } catch (e) {
          job.error = e.message;
          job.status = e.status || "failed";
          job.retryAt = e.retryAt || 0;
          if (
            !e.status &&
            /network|fetch|timeout|таймаут|HTTP 50/i.test(e.message) &&
            Number(job.attempts || 0) < 3
          ) {
            job.attempts = (job.attempts || 0) + 1;
            job.status = "waiting_retry";
            job.retryAt =
              this.now() + Math.min(300000, 10000 * 2 ** job.attempts);
          }
        }
        const latest = await this.repo.get("jobs", job.id);
        if (
          ["paused_user", "cancelled"].includes(latest?.status) &&
          latest.status !== job.status
        ) {
          job.status = latest.status;
        }
        await this.repo.put("jobs", job);
        return job;
      } finally {
        this.busy = false;
      }
    }
    async resume(id) {
      await this.repo.put("settings", { id: "networkPause", active: false });
      const j = await this.repo.get("jobs", id);
      if (j) {
        j.status = "queued";
        j.error = "";
        await this.repo.put("jobs", j);
      }
    }
  }
  root.RezkaSuiteJobs = { Runner, Paused };
  if (typeof module === "object") module.exports = root.RezkaSuiteJobs;
})(typeof globalThis !== "undefined" ? globalThis : this);
