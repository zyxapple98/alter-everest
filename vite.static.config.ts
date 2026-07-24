import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const siteOrigin =
    env.VITE_SITE_ORIGIN?.replace(/\/+$/, "") ||
    "https://alter-everest.test";
  const worldBaseUrl =
    env.VITE_WORLD_BASE_URL?.replace(/\/+$/, "") || "/data/world";
  return {
    base: env.VITE_BASE_PATH || "/",
    plugins: [
      {
        name: "absolute-social-origin",
        transformIndexHtml: {
          order: "pre",
          handler(html) {
            return html.replaceAll("%VITE_SITE_ORIGIN%", siteOrigin);
          },
        },
      },
      {
        name: "runtime-world-origin",
        async closeBundle() {
          await writeFile(
            resolve("dist-static/runtime-config.json"),
            `${JSON.stringify(
              { worldBaseUrl, pollIntervalMs: 30_000 },
              null,
              2,
            )}\n`,
          );
        },
      },
      react(),
    ],
    build: {
      outDir: "dist-static",
      emptyOutDir: true,
      sourcemap: true,
    },
  };
});
