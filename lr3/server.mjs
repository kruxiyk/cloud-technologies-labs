// Адаптер: застосунок Hono з src/index.js (ЛР2) як процес Node.js: node --env-file=config.env --env-file=.dev.vars server.mjs
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import app from "./src/index.js";
import { listWithConfig } from "./remote-config.js";

const DEFAULT_PORT = 8080;   // без змінної PORT

// Значення в лапках ('{…}' з .dev.vars) docker run --env-file передає разом з лапками: зняти їх.
const env = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, v.replace(/^'(.*)'$/s, "$1")]));
const port = Number(env.PORT ?? DEFAULT_PORT);            // з config.env; на Render — PORT=10000 платформи
const health = env.HEALTH_PATH ?? "/healthz";             // Health Check Path сервісу Render

// ЛР2 цього проєкту отримує login.html і login.js через прив'язку ASSETS.
// Файловий еквівалент прив'язки для Node.js; обробник API у src не змінюється.
const assets = new Map([
  ["/login.html", [readFileSync("public/login.html"), "text/html; charset=utf-8"]],
  ["/login.js", [readFileSync("public/login.js"), "text/javascript; charset=utf-8"]],
]);
env.ASSETS = { fetch(request) {
  const asset = assets.get(new URL(request.url).pathname);
  return asset ? new Response(asset[0], { headers: { "content-type": asset[1], "cache-control": "no-store" } })
    : new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
} };

serve({ port, fetch: (request) => {
  const path = new URL(request.url).pathname;
  const api = (r) => app.fetch(r, env);                 // як Cloudflare: запит і env, відповідь — від застосунку
  if (path === health) return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  if (request.method === "GET" && path === env.LIST_PATH) return listWithConfig(request, env, api);
  return api(request);
} });
console.log(`lr3-api: порт ${port}, перевірка стану ${health}`);
process.on("SIGTERM", () => process.exit(0));         // docker stop і Render: завершитися одразу, не за 10 с
