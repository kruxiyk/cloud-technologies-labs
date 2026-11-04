import { Firestore } from './firestore.js';
import { bad, day, integer, status, text, validate } from './validation.js';
const reply = (body, code = 200, headers = {}) => Response.json(body, { status: code, headers });
export function createApp(factory = env => new Firestore(env)) {
  return { async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const match = /^\/api\/parcels(?:\/([A-Za-z0-9_-]+)(\/events)?)?$/.exec(path);
      if (!match) return reply({ error: 'маршрут не знайдено' }, 404);
      const id = match[1];
      const events = Boolean(match[2]);
      const stats = id === 'stats' && !events;
      const allowed = !id || events ? ['GET', 'POST'] : ['GET'];
      if (!allowed.includes(request.method)) return reply({ error: 'метод не підтримується' }, 405, { Allow: allowed.join(', ') });
      if (request.method === 'POST' && (!env.ADMIN_TOKEN || request.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`)) return reply({ error: 'потрібен токен' }, 401, { 'WWW-Authenticate': 'Bearer' });
      const headers = request.method === 'GET' ? { 'cache-control': 'max-age=300' } : { 'cache-control': 'no-store' };
      const params = url.searchParams;
      let input;
      let query;
      if (request.method === 'POST') {
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return reply({ error: 'потрібен application/json' }, 415);
        const raw = await request.text();
        if (new TextEncoder().encode(raw).length > 16384) return reply({ error: 'тіло завелике' }, 413);
        try { input = JSON.parse(raw); } catch { bad('некоректний JSON'); }
        input = validate(input, events);
      } else if (!id) {
        query = { status: status(params.get('status')), city: text(params.get('city'), 'city'), limit: integer(params.get('limit'), 25, 1, 100), offset: integer(params.get('offset'), 0, 0, 2147483647) };
        if (params.has('cursor')) {
          if (query.offset) bad('cursor не сумісний з offset');
          try { query.cursor = JSON.parse(decodeURIComponent(atob(params.get('cursor')))); } catch { bad('некоректний cursor'); }
          if (!query.cursor || !/^[A-Za-z0-9_-]+$/.test(query.cursor.id) || typeof query.cursor.weight_kg !== 'number' || !Number.isFinite(query.cursor.weight_kg) || query.cursor.status !== query.status || query.cursor.city !== query.city) bad('cursor не відповідає фільтрам');
        }
      } else if (stats) query = day(params.get('day'));
      const store = factory(env);
      const parcel = id && !stats ? await store.get(id) : null;
      if (id && !stats && !parcel) return reply({ error: 'посилки немає' }, 404);
      if (request.method === 'POST') return reply(await store.create(input, events ? id : undefined), 201, headers);
      if (stats) return reply({ day: query, total_cod_amount: await store.stats(query) }, 200, headers);
      if (events) {
        const result = await store.events(id);
        return reply({ items: result.items }, 200, { ...headers, 'x-read-count': String(result.reads + 1) });
      }
      if (id) return reply(parcel, 200, { ...headers, 'x-read-count': '1' });
      const result = await store.list(query);
      const last = result.items.at(-1);
      const full = result.items.length === query.limit;
      const cursor = full ? btoa(encodeURIComponent(JSON.stringify({ id: last.id, weight_kg: last.weight_kg, status: query.status, city: query.city }))) : null;
      return reply({ items: result.items, next_offset: full ? query.offset + query.limit : null, next_cursor: cursor }, 200, { ...headers, 'x-read-count': String(result.reads) });
    } catch (error) {
      if (error.status === 400) return reply({ error: error.message }, 400);
      console.error('API error', error.message);
      return reply({ error: 'сервіс бази даних тимчасово недоступний' }, 503);
    }
  } };
}
export default createApp();
