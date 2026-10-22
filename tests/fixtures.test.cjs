const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { DOMParser } = require("linkedom"),
  C = require("../suite/core");
for (const fixture of require("./fixtures/index.json"))
  test("saved navigation: " + fixture.file, () => {
    const doc = new DOMParser().parseFromString(
        fs.readFileSync(path.join(__dirname, "fixtures", fixture.file), "utf8"),
        "text/html",
      ),
      r = C.parseDocument(doc, fixture.url);
    assert.equal(r.pagination.max, fixture.max);
    assert.equal(r.cards.length, fixture.cards);
  });
