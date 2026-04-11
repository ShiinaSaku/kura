import { defineConfig } from "rolldown";

export default defineConfig({
  input: {
    app: "app.ts",
    worker: "worker.ts",
    "api/index": "api/index.ts",
  },
  output: {
    dir: "dist",
    format: "esm",
    entryFileNames: "[name].mjs",
    sourcemap: true,
  },
  external: [
    /^node:/,
    "hono",
    "hono/vercel",
    "@hono/node-server",
  ],
});
