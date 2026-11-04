import { Firestore } from './firestore.js';
import { userFromRequest } from './auth.js';
import { bad, day, integer, status, text, validate } from './validation.js';
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const reply = (body, code = 200, headers = {}) => Response.json(body, { status: code, headers: { ...headers, 'cache-control': 'no-store' } });
const canAccess = (parcel, uid, moderator) => moderator || parcel.owner_uid === uid;
function bodyWithoutOwner(body, expected) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) bad('потрібен JSON-об’єкт');
  if (Object.hasOwn(body, 'owner_uid') && body.owner_uid !== expected) {
    const error = new Error('owner_uid не можна підмінювати'); error.status = 403; throw error;
  }
  const { owner_uid, ...payload } = body;
  return payload;
}
async function jsonBody(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    const error = new Error('потрібен application/json'); error.status = 415; throw error;
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 16384) { const error = new Error('тіло завелике'); error.status = 413; throw error; }
  try { return JSON.parse(raw); } catch { bad('некоректний JSON'); }
}
export function createApp(factory = env => new Firestore(env), authenticate = userFromRequest) {
  return { async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/firebase-config.json') {
        if (request.method !== 'GET') return reply({ error: 'метод не підтримується' }, 405, { Allow: 'GET' });
        return reply({ apiKey: env.FIREBASE_API_KEY, authDomain: env.FIREBASE_AUTH_DOMAIN, projectId: env.FIREBASE_PROJECT_ID });
      }
      if (url.pathname === '/login' || url.pathname === '/login.html' || url.pathname === '/login.js') {
        if (request.method !== 'GET') return reply({ error: 'метод не підтримується' }, 405, { Allow: 'GET' });
        const assetPath = url.pathname === '/login.js' ? '/login.js' : '/login.html';
        const asset = await env.ASSETS.fetch(new Request(new URL(assetPath, url), request));
        const response = new Response(asset.body, asset);
        response.headers.set('cache-control', 'no-store');
        response.headers.set('referrer-policy', 'no-referrer');
        response.headers.set('x-content-type-options', 'nosniff');
        return response;
      }
      if (!url.pathname.startsWith('/api/')) return reply({ error: 'маршрут не знайдено' }, 404);
      const user = await authenticate(request, env);
      if (!user.uid) return reply({ error: user.error }, user.status ?? 401, { 'WWW-Authenticate': 'Bearer' });
      const match = /^\/api\/parcels(?:\/([A-Za-z0-9_-]{1,64})(\/events)?)?$/.exec(url.pathname);
      if (!match) return reply({ error: 'маршрут не знайдено' }, 404);
      const id = match[1];
      const events = Boolean(match[2]);
      const stats = id === 'stats' && !events;
      const allowed = !id || events ? ['GET', 'POST'] : stats ? ['GET'] : ['GET', 'PATCH'];
      if (!allowed.includes(request.method)) return reply({ error: 'метод не підтримується' }, 405, { Allow: allowed.join(', ') });
      const store = factory(env);
      const moderator = await store.moderator(user.uid);
      const owner = moderator ? undefined : user.uid;
      const params = url.searchParams;
      if (!id && request.method === 'GET') {
        const query = { status: status(params.get('status')), city: text(params.get('city'), 'city'), limit: integer(params.get('limit'), 25, 1, 100), offset: integer(params.get('offset'), 0, 0, 2147483647), owner_uid: owner };
        if (params.has('cursor')) {
          if (query.offset) bad('cursor не сумісний з offset');
          try { query.cursor = JSON.parse(decodeURIComponent(atob(params.get('cursor')))); } catch { bad('некоректний cursor'); }
          const cursor = query.cursor;
          if (!cursor || typeof cursor.id !== 'string' || !ID_PATTERN.test(cursor.id) || !Number.isFinite(cursor.weight_kg) || cursor.status !== query.status || cursor.city !== query.city || cursor.scope !== (owner ?? 'moderator')) bad('cursor не відповідає фільтрам або доступу');
        }
        const result = await store.list(query);
        const last = result.items.at(-1);
        const full = result.items.length === query.limit;
        const next_cursor = full ? btoa(encodeURIComponent(JSON.stringify({ id: last.id, weight_kg: last.weight_kg, status: query.status, city: query.city, scope: owner ?? 'moderator' }))) : null;
        return reply({ items: result.items, next_offset: full ? query.offset + query.limit : null, next_cursor }, 200, { 'x-read-count': String(result.reads + 1) });
      }
      if (!id && request.method === 'POST') {
        const input = validate(bodyWithoutOwner(await jsonBody(request), user.uid));
        return reply(await store.create({ ...input, owner_uid: user.uid }), 201);
      }
      if (stats) {
        const date = day(params.get('day'));
        if (params.has('parcel_id')) {
          const parcelId = params.get('parcel_id');
          const parcel = ID_PATTERN.test(parcelId) ? await store.get(parcelId) : null;
          if (!parcel) return reply({ error: 'посилки немає' }, 404);
          if (!canAccess(parcel, user.uid, moderator)) return reply({ error: 'чужа посилка' }, 403);
          return reply({ day: date, parcel_id: parcelId, total_cod_amount: parcel.status === 'доставлено' && parcel.created_on === date ? parcel.cod_amount : 0 });
        }
        return reply({ day: date, total_cod_amount: await store.stats(date, owner) });
      }
      const parcel = await store.get(id);
      if (!parcel) return reply({ error: 'посилки немає' }, 404);
      if (!canAccess(parcel, user.uid, moderator)) return reply({ error: 'чужа посилка' }, 403);
      if (events && request.method === 'POST') return reply(await store.create(validate(bodyWithoutOwner(await jsonBody(request), user.uid), true), id), 201);
      if (events) {
        const result = await store.events(id);
        return reply({ items: result.items }, 200, { 'x-read-count': String(result.reads + 2) });
      }
      if (request.method === 'PATCH') {
        const changes = bodyWithoutOwner(await jsonBody(request), parcel.owner_uid);
        if (!Object.keys(changes).length) bad('немає полів для зміни');
        const { id: ignoredId, owner_uid: ignoredOwner, ...existing } = parcel;
        const validated = validate({ ...existing, ...changes });
        const normalized = Object.fromEntries(Object.keys(changes).map(field => [field, validated[field]]));
        return reply(await store.update(id, normalized));
      }
      return reply(parcel, 200, { 'x-read-count': '2' });
    } catch (error) {
      if ([400, 403, 413, 415].includes(error.status)) return reply({ error: error.message }, error.status);
      console.error('API error', error.message);
      return reply({ error: 'сервіс тимчасово недоступний' }, 503);
    }
  } };
}
export default createApp();
