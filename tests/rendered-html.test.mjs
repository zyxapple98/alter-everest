import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("https://alter-himalaya.test/", {
      headers: {
        accept: "text/html",
        host: "alter-himalaya.test",
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

test("renders the living mountain experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Alter \/\/ Himalaya/);
  assert.match(html, /Move the mountain/);
  assert.match(html, /RUN VERIFIED COMMIT/);
  assert.match(html, /The mountain/);
  assert.match(html, /expeditions\/agent-6319\.json/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships an absolute social preview URL", async () => {
  const response = await render();
  const html = await response.text();
  assert.match(html, /https:\/\/alter-himalaya\.test\/og\.png/);
});

