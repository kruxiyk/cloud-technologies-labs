import { createServer } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/index.js';
export async function fixture() {
  const users = new Map();
  const secret = randomBytes(32);
  const parcels = new Map();
  const children = new Map();
  let sequence = 0;
  const issue = (uid, extra = {}) => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: uid, user_id: uid, aud: 'lab1-v10-delivery', iss: 'https://securetoken.google.com/lab1-v10-delivery', exp: Math.floor(Date.now() / 1000) + 3600, ...extra })).toString('base64url');
    return `${header}.${payload}.${createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')}`;
  };
  const store = {
    moderator: async uid => uid === 'mod',
    get: async id => parcels.has(id) ? structuredClone(parcels.get(id)) : null,
    create: async (body, parent) => {
      const item = { ...structuredClone(body), id: `doc${++sequence}` };
      if (parent) { const events = children.get(parent) ?? []; events.push(item); children.set(parent, events); }
      else parcels.set(item.id, item);
      return item;
    },
    update: async (id, body) => { const item = { ...parcels.get(id), ...body }; parcels.set(id, item); return structuredClone(item); },
    list: async query => {
      let rows = [...parcels.values()].filter(item => item.status === query.status && item.city === query.city && (!query.owner_uid || item.owner_uid === query.owner_uid)).sort((left, right) => right.weight_kg - left.weight_kg || right.id.localeCompare(left.id));
      if (query.cursor) rows = rows.filter(item => item.weight_kg < query.cursor.weight_kg || item.weight_kg === query.cursor.weight_kg && item.id < query.cursor.id);
      return { items: structuredClone(rows.slice(query.offset, query.offset + query.limit)), reads: Math.max(1, Math.min(rows.length, query.offset + query.limit)) };
    },
    events: async id => ({ items: structuredClone(children.get(id) ?? []).sort((left, right) => right.at.localeCompare(left.at)), reads: Math.max(1, children.get(id)?.length ?? 0) }),
    stats: async (date, owner) => [...parcels.values()].filter(item => item.created_on === date && item.status === 'доставлено' && (!owner || item.owner_uid === owner)).reduce((total, item) => total + item.cod_amount, 0),
  };
  let lookupCount = 0;
  let environment;
  const app = createApp(() => store);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      if (incoming.url.startsWith('/identity/accounts:')) {
        const action = incoming.url.split('accounts:')[1].split('?')[0];
        const body = JSON.parse(raw);
        let result;
        if (action === 'signUp') {
          if (users.has(body.email)) result = { error: { message: 'EMAIL_EXISTS' } };
          else { const uid = body.email.split('@')[0]; users.set(body.email, { uid, password: body.password }); result = { localId: uid, idToken: issue(uid) }; }
        } else if (action === 'signInWithPassword') {
          const user = users.get(body.email);
          result = user && user.password === body.password ? { localId: user.uid, idToken: issue(user.uid) } : { error: { message: 'INVALID_LOGIN_CREDENTIALS' } };
        } else if (action === 'lookup') {
          lookupCount++;
          const [header, payload, signature] = (body.idToken ?? '').split('.');
          const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
          if (signature !== expected) result = { error: { message: 'INVALID_ID_TOKEN' } };
          else result = { users: [{ localId: JSON.parse(Buffer.from(payload, 'base64url')).sub }] };
        } else result = { error: { message: 'UNSUPPORTED' } };
        outgoing.writeHead(result.error ? 400 : 200, { 'content-type': 'application/json' });
        outgoing.end(JSON.stringify(result));
        return;
      }
      const request = new Request(base + incoming.url, { method: incoming.method, headers: incoming.headers, body: ['GET', 'HEAD'].includes(incoming.method) ? undefined : raw });
      const response = await app.fetch(request, environment);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch { outgoing.writeHead(500); outgoing.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  environment = { AUTH_URL: base + '/identity', FIREBASE_API_KEY: 'test-api-key', FIREBASE_PROJECT_ID: 'lab1-v10-delivery', FIREBASE_AUTH_DOMAIN: 'lab1-v10-delivery.firebaseapp.com', ASSETS: { fetch: async request => new Response(await readFile(new URL('../public' + new URL(request.url).pathname, import.meta.url), 'utf8'), { headers: { 'content-type': new URL(request.url).pathname.endsWith('.js') ? 'text/javascript' : 'text/html' } }) } };
  const call = async (path, uid = 'alice', method = 'GET', body, token) => {
    const response = await app.fetch(new Request(base + path, { method, headers: { 'content-type': 'application/json', ...(uid ? { authorization: `Bearer ${token ?? issue(uid)}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), environment);
    return response;
  };
  return { base, environment, store, parcels, issue, call, lookups: () => lookupCount, close: () => new Promise(resolve => server.close(resolve)) };
}
export const parcelBody = { tracking: 'TEST-V10', weight_kg: 2, city: 'Київ', status: 'доставлено', created_on: '2026-10-05', fragile: false, cod_amount: 100 };
export const eventBody = { at: '2026-10-05T10:00:00Z', location: 'Київ', note: 'Тест' };
