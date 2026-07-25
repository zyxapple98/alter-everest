import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.match(html, /WORLD 0/);
  assert.match(html, /NO EXPEDITIONS/);
  assert.match(html, /AWAITING FIRST EXPEDITION/);
  assert.doesNotMatch(html, /LIVE REPLAY/);
  assert.match(html, /CANONICAL METRES/);
  assert.match(html, /DRAG · ZOOM/);
  assert.match(html, /COPERNICUS GLO-30/);
  assert.match(html, /observatory-canvas/);
  assert.doesNotMatch(
    html,
    /RECENT EXPEDITIONS|PHYSICS v0\.2|RUN VERIFIED COMMIT|ROUND TRIP|ONE WAY|Expedition planner/i,
  );
});

test("ships an absolute social preview URL", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /https:\/\/alter-everest\.test\/og\.png/);
});

test("builds a provider-neutral static observatory", async () => {
  const html = await readFile(
    new URL("../dist-static/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /<title>ALTER EVEREST<\/title>/);
  assert.match(html, /https:\/\/alter-everest\.test\/og\.png/);
  assert.doesNotMatch(html, /__VINEXT|_next|%VITE_SITE_ORIGIN%/);
});
