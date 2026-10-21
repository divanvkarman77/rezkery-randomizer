(function (root) {
  "use strict";
  if (root.RezkaSite) return;
  const C = root.RezkaSuite;
  async function run(command) {
    try {
      if (command.op === "capture") {
        const result = C.parseDocument(document, location.href);
        result.login =
          !!document.querySelector(
            'input[name="login_name"],input[type="password"]',
          ) &&
          !result.folders.length &&
          !document.querySelector('a[href*="/logout/"]');
        return result;
      }
      const u = new URL(command.url, location.href);
      if (
        u.origin !== location.origin ||
        !["/ajax/favorites/", "/engine/ajax/quick_content.php"].includes(
          u.pathname,
        )
      )
        throw Error("Недопустимый адрес операции");
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 25000);
      let response;
      try {
        response = await fetch(u.href, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: new URLSearchParams(command.data || {}).toString(),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const html = await response.text();
      if (html.length > 5 * 1024 * 1024)
        throw Error("Слишком большой ответ сайта");
      const doc = new DOMParser().parseFromString(html, "text/html");
      if (C.challenge(doc)) return { challenge: true };
      if (response.status === 429)
        return {
          retryAfter: response.headers.get("Retry-After") || "60",
          error: "Сайт ограничил частоту (HTTP 429)",
        };
      if (!response.ok) throw Error("Сайт вернул HTTP " + response.status);
      if (u.pathname.includes("quick_content"))
        return {
          detail: {
            description: C.clean(
              doc.querySelector(
                ".b-content__bubble_text .text,.description,.b-content__bubble_text",
              )?.textContent || doc.body?.textContent,
            ),
            director: C.clean(
              doc.querySelector('[itemprop="director"]')?.textContent,
            ),
            cast: C.clean(doc.querySelector('[itemprop="actor"]')?.textContent),
          },
        };
      let data;
      try {
        data = JSON.parse(html);
      } catch {
        throw Error("Вместо ответа закладок получена страница. Проверьте вход");
      }
      if (!data || typeof data !== "object")
        throw Error("Пустой ответ закладок");
      if ([false, 0, "0", "false"].includes(data.success) || data.error)
        throw Error(
          C.clean(data.message || data.error || "Операция отклонена"),
        );
      return { data };
    } catch (e) {
      return { error: e.message || String(e) };
    }
  }
  root.RezkaSite = { run };
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage)
    chrome.runtime.onMessage.addListener((m, sender, reply) => {
      if (m?.type !== "SUITE_SITE" || sender.id !== chrome.runtime.id) return;
      run(m.command).then(reply);
      return true;
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
