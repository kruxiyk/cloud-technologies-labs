// Remote Config: параметр RC_PARAM серверного шаблону змінює запит 1 (GET LIST_PATH) і заголовок x-rc без розгортання.
import { cert, initializeApp } from "firebase-admin/app";
import { getRemoteConfig } from "firebase-admin/remote-config";

const CACHE_MS = 30_000;                                  // шаблон перечитується не частіше, ніж раз на 30 с
const MAX_LIMIT = 100;                                    // найбільший limit запиту 1
let template, loadedAt = 0;

// Сигнали запиту для умов шаблону: uid (умова Percent) і три власні сигнали (умова Custom signal).
function signals(request) {
  const ua = request.headers.get("user-agent") ?? "";
  let uid;                                                // uid з ID token лише розкодовується: токен перевіряє API
  try { uid = JSON.parse(Buffer.from(request.headers.get("authorization").split(".")[1], "base64url")).sub; } catch {}
  return {
    randomizationId: uid,
    language: (request.headers.get("accept-language") ?? "").split(/[,;-]/)[0].trim().toLowerCase(),   // uk-UA,uk;q=0.9 → uk
    browser: ua.includes("Edg/") ? "Edge" : ua.includes("Firefox/") ? "Firefox" : ua.includes("Chrome/") ? "Chrome" : "other",
    device_category: /Mobi|Android/.test(ua) ? "mobile" : "desktop",
  };
}

// Запит 1 з параметром RC_PARAM; api(request) — застосунок з src/index.js.
export async function listWithConfig(request, env, api) {
  const name = env.RC_PARAM;
  let value = null, source = "static", error = "";
  try {
    template ??= getRemoteConfig(initializeApp({ credential: cert(JSON.parse(env.GCP_SA_KEY)) })).initServerTemplate();
    if (Date.now() - loadedAt > CACHE_MS) { loadedAt = Date.now(); await template.load(); }
    const v = template.evaluate(signals(request)).getValue(name);
    source = v.getSource();
    if (source === "remote") value = v.asString();
  } catch (e) {                                           // немає ключа чи Google не відповів: запит 1 як у ЛР2
    error = e.code ?? e.name;
    console.error(`Remote Config: ${e.message}`);
  }
  const url = new URL(request.url);
  if (name === "list_page_size" && !url.searchParams.has("limit") && Number(value) >= 1 && Number(value) <= MAX_LIMIT) {
    url.searchParams.set("limit", String(parseInt(value, 10)));
    request = new Request(url, request);
  }
  const res = await api(request);
  const headers = new Headers(res.headers);
  headers.set("x-rc", `${name}=${value ?? ""}; source=${source}${error ? `; error=${error}` : ""}`);
  headers.delete("content-length");                       // тіло нижче може змінитися
  const body = res.status === 200 && value !== null ? await res.json() : null;
  if (body && name === "default_sort" && body.items.every((it) => value in it)) {
    body.items.sort((a, b) => (a[value] < b[value] ? 1 : a[value] > b[value] ? -1 : 0));   // від більшого до меншого
  }
  const child = name.match(/^show_(.+)_count$/)?.[1];    // show_checkouts_count → checkouts
  if (body && child && value === "true") {
    for (const it of body.items) {                        // запит 3 для кожного запису з тим самим токеном
      const r = await api(new Request(`${url.origin}${url.pathname}/${it.id}/${child}`, { headers: request.headers }));
      it[`${child}_count`] = r.ok ? (await r.json()).items.length : null;
    }
  }
  return new Response(body ? JSON.stringify(body) : res.body, { status: res.status, headers });
}
