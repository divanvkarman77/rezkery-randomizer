(function (root) {
  "use strict";
  function mount() {
    const $ = (id) => document.getElementById(id),
      data = JSON.parse($("rezka-suite-data").textContent),
      assets = new Map((data.assets || []).map((x) => [x.id, x.data])),
      details = new Map((data.details || []).map((x) => [x.id, x])),
      states = new Map((data.userState || []).map((x) => [x.id, x])),
      main = document.querySelector("main"),
      dialog = $("movieDetail");
    let filtered = [],
      limit = 60,
      index = 0;
    const normalize = (s) =>
      String(s || "")
        .toLowerCase()
        .replace(/ё/g, "е");
    function preferences() {
      try {
        localStorage.setItem(
          "rezka-suite-offline-ui",
          JSON.stringify({
            light: document.body.classList.contains("light"),
            view: $("view").value,
            columns: $("columns").value,
            height: $("posterHeight").value,
            mirror: $("mirror").value,
          }),
        );
      } catch {}
    }
    function show(m) {
      index = filtered.findIndex((x) => x.id === m.id);
      dialog.querySelector("h2").textContent = m.title;
      const state = states.get(m.id) || {};
      dialog.querySelector("p").textContent = [
        details.get(m.id)?.description,
        state.status,
        state.rating ? "Моя оценка: " + state.rating : "",
        state.note ? "Заметка: " + state.note : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const source = assets.get(m.posterAsset);
      $("largePoster").hidden = !source;
      if (source) {
        $("largePoster").src = source;
        $("zoomImage").src = source;
      }
      let u = new URL(m.url);
      try {
        if ($("mirror").value) {
          const base = new URL($("mirror").value);
          if (base.protocol === "https:")
            u = new URL(u.pathname + u.search, base.origin);
        }
      } catch {}
      dialog.querySelector("a").href = u.href;
      if (!dialog.open) dialog.showModal();
    }
    function render() {
      const words = normalize($("q").value).split(/\s+/).filter(Boolean);
      filtered = data.movies.filter(
        (m) =>
          words.every((w) =>
            normalize(
              m.search ||
                [
                  m.title,
                  m.originalTitle,
                  ...(m.countries || []),
                  ...(m.genres || []),
                ].join(" "),
            ).includes(w),
          ) &&
          (!$("year").value || m.year === +$("year").value) &&
          (!$("type").value || m.type === $("type").value),
      );
      main.replaceChildren();
      main.classList.toggle("list", $("view").value === "list");
      main.style.gridTemplateColumns =
        $("view").value === "list"
          ? "1fr"
          : +$("columns").value
            ? "repeat(" + $("columns").value + ",minmax(0,1fr))"
            : "repeat(auto-fill,minmax(180px,1fr))";
      document.documentElement.style.setProperty(
        "--poster-height",
        $("posterHeight").value + "px",
      );
      for (const m of filtered.slice(0, limit)) {
        const node = document.createElement("article");
        if (assets.has(m.posterAsset)) {
          const image = document.createElement("img");
          image.src = assets.get(m.posterAsset);
          image.loading = "lazy";
          image.alt = "";
          image.onclick = () => {
            show(m);
            $("posterZoom").showModal();
          };
          node.append(image);
        }
        const title = document.createElement("button");
        title.textContent = m.title;
        title.onclick = () => show(m);
        const meta = document.createElement("p");
        meta.textContent = [m.year, m.type, (m.genres || []).join(", ")]
          .filter(Boolean)
          .join(" · ");
        node.append(title, meta);
        main.append(node);
      }
      $("count").textContent = filtered.length + " карточек";
      $("more").hidden = limit >= filtered.length;
      preferences();
    }
    try {
      const saved = JSON.parse(
        localStorage.getItem("rezka-suite-offline-ui") || "{}",
      );
      document.body.classList.toggle("light", !!saved.light);
      for (const [key, id] of Object.entries({
        view: "view",
        columns: "columns",
        height: "posterHeight",
        mirror: "mirror",
      }))
        if (saved[key] !== undefined) $(id).value = saved[key];
    } catch {}
    for (const id of ["q", "year", "type", "view", "columns", "posterHeight"])
      $(id).oninput = () => {
        limit = 60;
        render();
      };
    $("mirror").onchange = preferences;
    $("theme").onclick = () => {
      document.body.classList.toggle("light");
      preferences();
    };
    $("random").onclick = () => {
      if (filtered.length)
        show(filtered[Math.floor(Math.random() * filtered.length)]);
    };
    $("close").onclick = () => dialog.close();
    $("zoomClose").onclick = () => $("posterZoom").close();
    $("largePoster").onclick = () => $("posterZoom").showModal();
    $("more").onclick = () => {
      limit += 60;
      render();
    };
    const next = (delta) => {
      if (filtered.length)
        show(filtered[(index + delta + filtered.length) % filtered.length]);
    };
    $("previousMovie").onclick = () => next(-1);
    $("nextMovie").onclick = () => next(1);
    document.addEventListener("keydown", (e) => {
      if (dialog.open && e.key === "ArrowLeft") next(-1);
      if (dialog.open && e.key === "ArrowRight") next(1);
    });
    render();
  }
  root.RezkaSuiteViewer = { mount };
  if (typeof module === "object") module.exports = root.RezkaSuiteViewer;
})(typeof globalThis !== "undefined" ? globalThis : this);
