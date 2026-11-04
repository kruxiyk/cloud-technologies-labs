// Перевірка доступу до API ЛР2 трьома тестовими користувачами alice, bob і mod: node check2.mjs <адреса API> <apiKey>.
// Етап 4: --delete bob видаляє bob і пише його останній токен у bob-token.txt; --token bob друкує токен bob.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------------------------
// Налаштування під свій варіант. Змінюється лише цей блок.
// ---------------------------------------------------------------------------------------------
const CONFIG = {
  access: "moderator",                      // модель доступу з картки: "owner", "owner_public" або "moderator"
  platform: "Firestore",                    // "D1" або "Firestore": куди додається модератор
  database: "lr1-db",                       // назва бази D1 з wrangler.jsonc
  resource: "/api/parcels",
  child: "events",
  list: "status=доставлено&city=Перевірка-ЛР2&limit=100",
  stats: (id) => `parcel_id=${id}&day=2026-10-05`,
  newItem: { tracking: "CHECK2-V10", weight_kg: 1.5, city: "Перевірка-ЛР2", status: "доставлено", created_on: "2026-10-05", fragile: false, cod_amount: 100 },
  newChild: { at: "2026-10-05T10:00:00Z", location: "Київ", note: "Перевірка доступу ЛР2" },
  mutations: ["PATCH"],
  patch: { cod_amount: 125 },
};
// ---------------------------------------------------------------------------------------------

const [url, API_KEY, flag, flagUser] = process.argv.slice(2);   // адреса, apiKey і, для етапу 4, --token чи --delete з ім’ям
const BASE = (url ?? "http://localhost:8787").replace(/\/$/, "");
const AUTH_URL = process.env.CHECK2_AUTH_URL ?? "https://identitytoolkit.googleapis.com/v1";   // CHECK2_AUTH_URL — лише тест
const USERS_FILE = ".test-users.json";
const PASSWORD_BYTES = 18;                  // випадковий пароль: 18 байтів = 24 символи base64url
const MISSING_ID = "999999";                // id, якого немає в базі
const R = CONFIG.resource;
const PUBLIC = CONFIG.access === "owner_public";
const MODERATOR = CONFIG.access === "moderator";

if (!API_KEY) { console.log("Використання: node check2.mjs <адреса API> <apiKey> [--token <ім’я> | --delete <ім’я>]"); process.exit(1); }

// Користувач Identity Toolkit: вхід зі збереженим паролем або реєстрація (також після видалення в етапі 4).
// Паролі не пишуться у файл, який git може закомітити (код 1 — не ігнорується; 128 — тут немає репозиторію).
if (spawnSync("git", ["check-ignore", "-q", USERS_FILE]).status === 1) { console.log(`${USERS_FILE} немає в .gitignore`); process.exit(1); }
const passwords = existsSync(USERS_FILE) ? JSON.parse(readFileSync(USERS_FILE, "utf8")) : {};
// connection: close — без цього Node.js на Windows може аварійно завершитися після process.exit (перевірено з Node 26.3.0).
const identity = (method, body) => fetch(`${AUTH_URL}/accounts:${method}?key=${API_KEY}`, {
  method: "POST", headers: { "content-type": "application/json", connection: "close" }, body: JSON.stringify({ ...body, returnSecureToken: true }),
}).then((r) => r.json());
// Лише вхід, без реєстрації: після видалення в етапі 4 вхід має не вдатися.
async function signIn(name) {
  const email = `${name}@example.com`;
  const data = await identity("signInWithPassword", { email, password: passwords[email] ?? "" });
  if (!data.idToken) { console.error(`${email}: ${data.error?.message}`); process.exit(1); }
  return data.idToken;
}
if (flag === "--token") { console.log(await signIn(flagUser)); process.exit(0); }
if (flag === "--delete") {
  const idToken = await signIn(flagUser);
  writeFileSync(`${flagUser}-token.txt`, idToken);   // старий токен для етапу 4.3 і вправи 4.4
  const data = await identity("delete", { idToken });
  console.log(data.error ? `${flagUser}@example.com: ${data.error.message}`
    : `${flagUser}@example.com видалено; його останній токен ідентичності у файлі ${flagUser}-token.txt`);
  process.exit(data.error ? 1 : 0);
}

async function user(name) {
  const email = `${name}@example.com`;
  let data = passwords[email] ? await identity("signInWithPassword", { email, password: passwords[email] }) : {};
  if (!data.idToken) {
    passwords[email] ??= randomBytes(PASSWORD_BYTES).toString("base64url");
    data = await identity("signUp", { email, password: passwords[email] });
    writeFileSync(USERS_FILE, JSON.stringify(passwords, null, 2));
  }
  if (!data.idToken) { console.log(`${email}: ${data.error?.message}`); process.exit(1); }
  return { uid: data.localId, auth: `Bearer ${data.idToken}` };
}
const alice = await user("alice"), bob = await user("bob"), mod = await user("mod");

console.log(`uid модератора mod@example.com: ${mod.uid}`);
const where = /localhost|127\.0\.0\.1/.test(BASE) ? "--local" : "--remote";
console.log(CONFIG.platform === "D1"
  ? `Додати в roles: npx wrangler d1 execute ${CONFIG.database} ${where} --command "INSERT OR REPLACE INTO roles (uid, role) VALUES ('${mod.uid}', 'moderator')"`
  : `Додати в roles: консоль Firebase → Firestore Database → колекція roles → документ ${mod.uid} → поле role (string) = moderator`);
console.log();

// Підроблений токен: дані alice з uid bob, підпис alice; підпис не збігається, тож API має відповісти 401.
const [head, body, sig] = alice.auth.slice("Bearer ".length).split(".");
const claims = JSON.parse(Buffer.from(body, "base64url"));
const forged = `Bearer ${head}.${Buffer.from(JSON.stringify({ ...claims, sub: bob.uid, user_id: bob.uid })).toString("base64url")}.${sig}`;

let passed = 0, total = 0;
// Один запит [метод, шлях, шлях у виводі без id записів, тіло]: код відповіді, Cache-Control і перевірка тіла.
async function call(title, [method, path, shown = path, payload], auth, expect, check) {
  const headers = auth ? { authorization: auth } : {};
  if (payload) headers["content-type"] = "application/json";
  const res = await fetch(BASE + encodeURI(path), { method, headers, body: payload && JSON.stringify(payload) });
  const text = await res.text();
  const data = res.headers.get("content-type")?.includes("application/json") && text ? JSON.parse(text) : null;
  const problems = [];
  if (res.status !== expect) problems.push(`очікувався код ${expect}`);
  const cache = res.headers.get("cache-control") ?? "";   // кожна відповідь API: no-store
  if (cache !== "no-store") problems.push(`cache-control: ${cache || "немає"}`);
  if (!problems.length && check) problems.push(...check(data));
  total++;
  if (!problems.length) passed++;
  console.log(`${problems.length ? "✘" : "✔"} ${title}: ${method} ${shown} → ${res.status}` +
    (problems.length ? `  (${problems.join("; ")}) ${text.slice(0, 200)}` : ""));
  return data;
}
const listed = (d, item) => d?.items?.some((it) => String(it.id) === String(item.id));

// 1. Без дійсного ID token: 401 (у owner_public читання без токена дозволене).
const LIST = ["GET", `${R}?${CONFIG.list}`, `${R}?…`];
const CREATE = ["POST", R, R, CONFIG.newItem];
await call("без токена", LIST, "", PUBLIC ? 200 : 401);
await call("без токена", CREATE, "", 401);
await call("не JWT", CREATE, "Bearer not-a-jwt", 401);
await call("підроблений токен", CREATE, forged, 401);

// 2. owner_uid лише з токена.
const a = await call("alice створює", CREATE, alice.auth, 201,
  (d) => (d?.owner_uid === alice.uid ? [] : [`owner_uid ${d?.owner_uid} ≠ uid alice`]));
await call("alice з owner_uid bob", ["POST", R, R, { ...CONFIG.newItem, owner_uid: bob.uid }], alice.auth, 403);
const b = await call("bob створює", CREATE, bob.auth, 201,
  (d) => (d?.owner_uid === bob.uid ? [] : [`owner_uid ${d?.owner_uid} ≠ uid bob`]));
if (!a?.id || !b?.id) { console.log("\nЗаписи не створено: подальші перевірки не мають сенсу"); process.exit(1); }

// 3. Свої й чужі записи на всіх видах маршрутів; :alice і :bob у виводі — id записів alice і bob.
const ONE = (it, who) => ["GET", `${R}/${it.id}`, `${R}/:${who}`];
const STATS = ["GET", `${R}/stats?${CONFIG.stats(a.id)}`, `${R}/stats?:alice`];
const CHILDREN = (it, who) => ["GET", `${R}/${it.id}/${CONFIG.child}`, `${R}/:${who}/${CONFIG.child}`];
const ADD_CHILD = (it, who) => ["POST", `${R}/${it.id}/${CONFIG.child}`, `${R}/:${who}/${CONFIG.child}`, CONFIG.newChild];
const MUTATE = (m, it, who) => [m, `${R}/${it.id}`, `${R}/:${who}`, m === "PATCH" ? CONFIG.patch : undefined];
await call("alice читає свій", ONE(a, "alice"), alice.auth, 200);
await call("bob читає чужий", ONE(a, "alice"), bob.auth, PUBLIC ? 200 : 403);
await call("alice: список", LIST, alice.auth, 200,
  (d) => (listed(d, a) && listed(d, b) === PUBLIC ? [] : ["у списку не ті записи"]));
await call("alice: статистика свого", STATS, alice.auth, 200);
await call("bob: статистика чужого", STATS, bob.auth, PUBLIC ? 200 : 403);
await call("alice додає дочірній", ADD_CHILD(a, "alice"), alice.auth, 201);
await call("bob додає чужому", ADD_CHILD(a, "alice"), bob.auth, 403);
await call("alice: дочірні свого", CHILDREN(a, "alice"), alice.auth, 200,
  (d) => (d?.items?.length === 1 ? [] : [`дочірніх ${d?.items?.length} ≠ 1`]));
await call("bob: дочірні чужого", CHILDREN(a, "alice"), bob.auth, PUBLIC ? 200 : 403);
await call("alice: неіснуючий", ["GET", `${R}/${MISSING_ID}`], alice.auth, 404);
// Ролі API не записує: маршруту немає, тож стати модератором через API не можна.
await call("alice додає себе в roles", ["POST", "/api/roles", "/api/roles", { uid: alice.uid, role: "moderator" }], alice.auth, 404);
for (const m of CONFIG.mutations) await call(`bob: ${m} чужого`, MUTATE(m, a, "alice"), bob.auth, 403);

// 4. Модератор: читає й змінює будь-який запис; в інших моделях mod — звичайний користувач.
const SEES_ALL = MODERATOR || PUBLIC;
await call("mod читає чужий", ONE(b, "bob"), mod.auth, SEES_ALL ? 200 : 403);
await call("mod: список", LIST, mod.auth, 200,
  (d) => (listed(d, a) === SEES_ALL && listed(d, b) === SEES_ALL ? [] : ["у списку не ті записи"]));
await call("mod додає дочірній чужому", ADD_CHILD(b, "bob"), mod.auth, MODERATOR ? 201 : 403);
for (const m of CONFIG.mutations) {
  const ok = m === "DELETE" ? 204 : 200;
  await call(`mod: ${m} чужого`, MUTATE(m, b, "bob"), mod.auth, MODERATOR ? ok : 403);
  await call(`alice: ${m} свого`, MUTATE(m, a, "alice"), alice.auth, ok);
}

console.log(`\nПройшло ${passed} з ${total}`);
process.exit(passed === total ? 0 : 1);
