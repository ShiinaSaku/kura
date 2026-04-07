import "dotenv/config";
import { serve } from "@hono/node-server";
import app from "./api/app.js";

const port = Number(process.env.PORT ?? process.env.port ?? 9000);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});
