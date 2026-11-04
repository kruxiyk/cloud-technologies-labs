// Значення Remote Config для alice, bob і mod: node rc.mjs <адреса API> "<шлях списку>" [умова з картки: uk, Edge, mobile…]
import { spawnSync } from "node:child_process";

process.loadEnvFile("config.env");           // FIREBASE_API_KEY для входу користувачів
const [url, path, condition] = process.argv.slice(2);
if (!url || !path?.startsWith("/")) {
  console.log('Використання: node rc.mjs <адреса API> "<шлях списку>" [мова, браузер чи mobile з картки]');
  process.exit(1);
}
const BASE = url.replace(/\/$/, "");
const TIMEOUT_MS = 120_000;                  // перший запит до сплячого сервісу Render триває до хвилини
const UA = {
  Edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  Firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
  Chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  mobile: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
};
// Два запити: базовий (без мови, не браузер) і з умовою картки; без умови — лише базовий.
const requests = [["базовий", { "user-agent": "node" }]];
if (UA[condition]) requests.push([condition === "mobile" ? "пристрій mobile" : `браузер ${condition}`, { "user-agent": UA[condition] }]);
else if (condition) requests.push([`мова ${condition}`, { "user-agent": "node", "accept-language": condition }]);

function idToken(name) {                     // токен з check2.mjs (паролі з .test-users.json)
  const r = spawnSync(process.execPath, ["check2.mjs", BASE, process.env.FIREBASE_API_KEY, "--token", name], { encoding: "utf8" });
  if (r.status !== 0) { console.log(`${name}: немає токена (${r.stderr.trim()}); спершу node check2.mjs`); return null; }
  return r.stdout.trim();
}

console.log(`${"користувач".padEnd(11)}${"запит".padEnd(17)}код записів x-rc`);
for (const name of ["alice", "bob", "mod", null]) {
  const token = name && idToken(name);
  if (name && !token) continue;
  for (const [label, headers] of name ? requests : requests.slice(0, 1)) {
    const auth = token ? { authorization: `Bearer ${token}` } : {};
    const r = await fetch(`${BASE}${path}`, { headers: { ...headers, ...auth }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const items = (await r.json().catch(() => ({}))).items;
    const count = Array.isArray(items) ? String(items.length) : "-";
    console.log(`${(name ?? "без токена").padEnd(11)}${label.padEnd(17)}${r.status} ${count.padStart(7)} ${r.headers.get("x-rc") ?? "-"}`);
  }
}
