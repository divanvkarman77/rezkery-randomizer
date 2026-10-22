(function () {
  "use strict";
  const api = globalThis.browser || globalThis.chrome,
    firefox = !!globalThis.browser,
    C = RezkaSuite,
    repo = new RezkaSuiteRepository.Repository();
  function call(area, method, ...args) {
    const owner = area === "storage" ? api.storage.local : api[area];
    return firefox
      ? owner[method](...args)
      : new Promise((resolve, reject) =>
          owner[method](...args, (r) => {
            const e = api.runtime.lastError;
            e ? reject(Error(e.message)) : resolve(r);
          }),
        );
  }
  let tabId = null;
  async function capture(url) {
    if (!tabId) {
      const tab = await call("tabs", "create", {
        url: "about:blank",
        active: false,
      });
      tabId = tab.id;
      await repo.put("settings", { id: "ownedTab", tabId });
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => finish(Error("Таймаут страницы HDRezka")),
        30000,
      );
      function finish(e) {
        clearTimeout(timer);
        api.tabs.onUpdated.removeListener(listener);
        e ? reject(e) : resolve();
      }
      function listener(id, change) {
        if (id === tabId && change.status === "complete") finish();
      }
      api.tabs.onUpdated.addListener(listener);
      call("tabs", "update", tabId, { url, active: false }).then((tab) => {
        if (tab.status === "complete") finish();
      }, finish);
    });
    const tab = await call("tabs", "get", tabId);
    if (new URL(tab.url).origin !== new URL(url).origin)
      throw Error(
        "Зеркало перенаправило на другой домен: укажите его в настройках",
      );
    await call("scripting", "executeScript", {
      target: { tabId },
      files: ["suite/core.js", "suite/site.js"],
    });
    return call("tabs", "sendMessage", tabId, {
      type: "SUITE_SITE",
      command: { op: "capture" },
    });
  }
  async function image(url) {
    const u = new URL(url);
    if (u.protocol !== "https:")
      throw Error("Постер должен использовать HTTPS");
    const c = new AbortController(),
      timer = setTimeout(() => c.abort(), 25000);
    try {
      const r = await fetch(u.href, {
        signal: c.signal,
        credentials: "include",
      });
      if (r.status === 429)
        return {
          retryAfter: r.headers.get("Retry-After") || "60",
          error: "HTTP 429",
        };
      if (!r.ok) throw Error("Постер: HTTP " + r.status);
      const type = r.headers.get("content-type")?.split(";")[0] || "";
      if (!/^image\/(jpeg|png|gif|webp)$/.test(type))
        return { challenge: true };
      const reader = r.body.getReader(),
        parts = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 10 * 1024 * 1024) {
          await reader.cancel();
          throw Error("Постер больше 10 МБ");
        }
        parts.push(value);
      }
      let s = "";
      for (const p of parts) for (const b of p) s += String.fromCharCode(b);
      return { data: "data:" + type + ";base64," + btoa(s) };
    } finally {
      clearTimeout(timer);
    }
  }
  const runner = new RezkaSuiteJobs.Runner(repo, async (job, command) => {
    if (command.op === "image") return image(command.url);
    if (command.op === "capture") return capture(command.url);
    const origin = new URL(job.params.url).origin;
    if (!tabId) await capture(new URL("/favorites/", origin).href);
    const tab = await call("tabs", "get", tabId);
    if (new URL(tab.url).origin !== origin)
      await capture(new URL("/favorites/", origin).href);
    return call("tabs", "sendMessage", tabId, { type: "SUITE_SITE", command });
  });
  let legacyWrites = Promise.resolve(),
    legacyReads = Promise.resolve();
  globalThis.RezkaSuitePublishSelected = (movies) => {
    legacyWrites = legacyWrites
      .catch(() => {})
      .then(async () => {
        const data = await call("storage", "get", [
            "rz_movies_v1",
            "rz_used_v1",
          ]),
          old = data.rz_movies_v1 || [],
          map = new Map(old.map((m) => [C.identity(m), m])),
          used = new Set(data.rz_used_v1 || []);
        let changed = map.size !== old.length;
        for (const m of movies) {
          if (!map.has(m.id)) {
            map.set(m.id, C.legacyItem(m));
            changed = true;
          }
          const path = C.path(m.url);
          if (path && !used.has(path)) {
            used.add(path);
            changed = true;
          }
        }
        if (changed)
          await call("storage", "set", {
            rz_movies_v1: [...map.values()],
            rz_used_v1: [...used],
          });
      });
    return legacyWrites;
  };
  async function learnLegacy(movies) {
    const reset = (await repo.get("settings", "legacyResetAt"))?.at || 0;
    for (let n = 0; n < movies.length; n += 100) {
      const part = movies.slice(n, n + 100),
        known = await repo.getMany(
          "history",
          part.map((m) => C.identity(m) || "invalid"),
        ),
        incoming = part.filter(
          (m, i) =>
            !known[i] && (!reset || C.stamp(m.addedAt || m.date, 0) > reset),
        );
      if (incoming.length) await runner.ingest(incoming, null, true, "legacy");
    }
  }
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && Array.isArray(changes.rz_movies_v1?.newValue)) {
      const rows = changes.rz_movies_v1.newValue;
      legacyReads = legacyReads.catch(() => {}).then(() => learnLegacy(rows));
    }
  });
  async function closeTab() {
    if (tabId) {
      try {
        await call("tabs", "remove", tabId);
      } catch {}
      tabId = null;
      await repo.delete("settings", "ownedTab");
    }
  }
  let pumping = false;
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      const preferences = await repo.get("settings", "preferences"),
        last = await repo.get("settings", "autoSyncAt"),
        paused = await repo.get("settings", "networkPause");
      if (
        preferences?.autoSync &&
        !paused?.active &&
        Date.now() - (last?.at || 0) > 1800000
      ) {
        const jobs = await repo.all("jobs");
        if (
          !jobs.some(
            (j) =>
              j.kind === "bookmarks" &&
              !["completed", "cancelled", "failed"].includes(j.status),
          )
        ) {
          await runner.enqueue("bookmarks", {
            url: preferences.origin,
            direction: "random-import",
            auto: true,
          });
          await repo.put("settings", { id: "autoSyncAt", at: Date.now() });
        }
      }
      for (let n = 0; n < 100; n++) {
        const j = await runner.tick();
        if (!j) break;
        if (["waiting_challenge", "paused_auth"].includes(j.status)) {
          if (tabId && !j.params.auto)
            await call("tabs", "update", tabId, { active: true });
          else if (tabId) await closeTab();
          tabId = null;
          await repo.delete("settings", "ownedTab");
          break;
        }
        if (j.status !== "running") {
          await closeTab();
          if (j.status !== "completed") break;
        }
      }
    } catch (e) {
      console.error("Suite:", e.message);
    } finally {
      pumping = false;
    }
  }
  api.runtime.onMessage.addListener((m, sender, reply) => {
    if (m?.type !== "SUITE_COMMAND") return;
    if (
      sender.id !== api.runtime.id ||
      !sender.url?.startsWith(api.runtime.getURL("suite/"))
    ) {
      reply({ error: "Недопустимый источник" });
      return;
    }
    const run = async () => {
      if (m.action === "enqueue") {
        if (!["scan", "bookmarks", "details", "posters"].includes(m.kind))
          throw Error("Неизвестное задание");
        const value = await runner.enqueue(m.kind, m.params);
        pump();
        return value;
      }
      if (m.action === "resume") {
        await runner.resume(m.id);
        pump();
        return;
      }
      throw Error("Неизвестная команда");
    };
    run().then(
      (value) => reply({ value }),
      (e) => reply({ error: e.message }),
    );
    return true;
  });
  api.alarms.onAlarm.addListener((a) => {
    if (a.name === "rezka-suite") pump();
  });
  api.alarms.create("rezka-suite", { periodInMinutes: 1 });
  (async () => {
    await repo.open();
    const legacy = await call("storage", "get", ["rz_movies_v1"]);
    await learnLegacy(legacy.rz_movies_v1 || []);
    const owned = await repo.get("settings", "ownedTab");
    if (owned?.tabId) {
      try {
        await call("tabs", "remove", owned.tabId);
      } catch {}
      await repo.delete("settings", "ownedTab");
    }
    pump();
  })().catch((e) => console.error(e.message));
})();
