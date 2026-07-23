import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://alter-everest.test/", {
      headers: {
        accept: "text/html",
        host: "alter-everest.test",
        "x-forwarded-proto": "https",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the read-only Everest observatory", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>ALTER EVEREST<\/title>/);
  assert.match(html, /Matter moves/);
  assert.match(html, /RECENT EXPEDITIONS/);
  assert.match(html, /PHYSICS v0\.2/);
  assert.doesNotMatch(
    html,
    /RUN VERIFIED COMMIT|ROUND TRIP|ONE WAY|Expedition planner/i,
  );
});

test("ships an absolute social preview URL", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /https:\/\/alter-everest\.test\/og\.png/);
});

