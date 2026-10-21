const fs = require("node:fs"),
  path = require("node:path"),
  cp = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  suite = path.join(root, "suite");
for (const name of fs.readdirSync(suite))
  if (name.endsWith(".js"))
    cp.execFileSync(process.execPath, ["--check", path.join(suite, name)]);
for (const variant of [
  "chrome109-win7",
  "chrome-modern",
  "firefox115-esr",
  "firefox-modern",
]) {
  const dir = path.join(root, "extension", variant),
    target = path.join(dir, "suite");
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(suite))
    if (/\.(js|css|html)$/.test(name))
      fs.copyFileSync(path.join(suite, name), path.join(target, name));
  const manifestPath = path.join(dir, "manifest.json"),
    m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  m.name =
    "Rezka Suite — " +
    {
      "chrome109-win7": "Chrome 109 / Windows 7",
      "chrome-modern": "Chrome",
      "firefox115-esr": "Firefox 115 ESR",
      "firefox-modern": "Firefox",
    }[variant];
  m.version = "2.0.0.1";
  m.version_name = "2.0.0-alpha.1";
  m.permissions = [...new Set([...m.permissions, "alarms"])];
  const scripts = [
    "suite/core.js",
    "suite/repository.js",
    "suite/importer.js",
    "suite/jobs.js",
    "suite/extension-worker.js",
  ];
  if (variant.startsWith("chrome")) {
    m.minimum_chrome_version = "109";
    m.background = { service_worker: "suite-worker.js" };
    fs.writeFileSync(
      path.join(dir, "suite-worker.js"),
      "importScripts('background.js'," +
        scripts.map((s) => JSON.stringify(s)).join(",") +
        ");\n",
    );
  } else {
    m.browser_specific_settings = {
      ...(m.browser_specific_settings || {}),
      gecko: {
        ...(m.browser_specific_settings?.gecko || {}),
        id:
          variant === "firefox115-esr"
            ? "rezka-suite-esr@rezkery.local"
            : "rezka-suite@rezkery.local",
        strict_min_version: "115.0",
      },
    };
    m.background = { scripts: ["background.js", ...scripts] };
  }
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + "\n");
  const popup = path.join(dir, "popup.html");
  let html = fs.readFileSync(popup, "utf8");
  if (!html.includes("suite/index.html"))
    html = html.replace(
      '<nav class="tabs">',
      '<p style="margin:8px 12px"><a href="suite/index.html" target="_blank" style="color:inherit">📚 Открыть общую библиотеку Suite</a></p>\n    <nav class="tabs">',
    );
  fs.writeFileSync(popup, html);
  console.log("Suite:", variant);
}
