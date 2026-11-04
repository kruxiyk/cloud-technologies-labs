import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/index.js';
import { validate } from '../src/validation.js';
import { Firestore, fields, document } from '../src/firestore.js';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const dataset = JSON.parse(await readFile(new URL('../data/parcels.json', import.meta.url), 'utf8'));
function setup() {
  const rows = dataset.map(({ events, ...body }, index) => ({ ...body, id: String(index).padStart(3, '0') }));
  const store = {
    get: async id => rows.find(row => row.id === id),
    create: async (body, id) => ({ ...body, id: id ? 'event-new' : 'parcel-new' }),
    list: async query => {
      let filtered = rows.filter(row => row.status === query.status && row.city === query.city).sort((left, right) => right.weight_kg - left.weight_kg || right.id.localeCompare(left.id));
      if (query.cursor) filtered = filtered.filter(row => row.weight_kg < query.cursor.weight_kg || (row.weight_kg === query.cursor.weight_kg && row.id < query.cursor.id));
      return { items: filtered.slice(query.offset, query.offset + query.limit), reads: Math.max(1, Math.min(filtered.length, query.offset + query.limit)) };
    },
    events: async () => ({ items: dataset[0].events, reads: 2 }),
    stats: async date => rows.filter(row => row.status === 'доставлено' && row.created_on === date).reduce((sum, row) => sum + row.cod_amount, 0),
  };
  const app = createApp(() => store);
  return { store, call: (path, method = 'GET', body, token) => app.fetch(new Request('https://test/api/parcels' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), { ADMIN_TOKEN: 'secret' }) };
}
const query = '?' + new URLSearchParams({ status: 'доставлено', city: 'Київ' });
test('26 збігів: 25+1, курсор з кирилицею, однакова вага без пропусків', async () => {
  const { call } = setup();
  const first = await call(query);
  assert.equal(first.headers.get('cache-control'), 'max-age=300');
  assert.equal(first.headers.get('x-read-count'), '25');
  const page = await first.json();
  assert.equal(page.items.length, 25);
  const second = await (await call(query + '&offset=25')).json();
  const cursor = await (await call(query + '&cursor=' + encodeURIComponent(page.next_cursor))).json();
  assert.deepEqual(second.items, cursor.items);
  assert.equal(second.items.length, 1);
  assert.equal(new Set([...page.items, ...second.items].map(row => row.id)).size, 26);
});
test('статистика, порожня сума, історія та один документ', async () => {
  const { call } = setup();
  assert.equal((await (await call('/stats?day=2026-03-15')).json()).total_cod_amount, 16942.25);
  assert.equal((await (await call('/stats?day=2000-01-01')).json()).total_cod_amount, 0);
  assert.equal((await call('/000')).headers.get('x-read-count'), '1');
  const events = await call('/000/events');
  assert.equal(events.headers.get('x-read-count'), '3');
  assert.equal((await events.json()).items.length, 2);
});
test('POST захищено, правильні сутності створюються', async () => {
  const { call } = setup();
  const { events, ...parcel } = dataset[0];
  for (const token of [undefined, 'wrong']) assert.equal((await call('', 'POST', parcel, token)).status, 401);
  assert.equal((await call('', 'POST', parcel, 'secret')).status, 201);
  assert.equal((await call('/000/events', 'POST', events[0], 'secret')).status, 201);
  assert.equal((await call('/missing/events', 'POST', events[0], 'secret')).status, 404);
});
test('400, 404, 405 та помилки без кешу', async () => {
  const { call } = setup();
  for (const path of ['', query + '&limit=-1', query + '&offset=1.2', '/stats?day=2026-02-30', query + '&cursor=bad']) {
    const response = await call(path);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), null);
  }
  assert.equal((await call('/missing')).status, 404);
  for (const method of ['PUT', 'PATCH', 'DELETE']) assert.equal((await call('/000', method)).status, 405);
});
test('межі чисел, типи, дати, невідомі поля', () => {
  const { events, ...parcel } = dataset[0];
  for (const change of [{ weight_kg: 0 }, { weight_kg: 1001 }, { cod_amount: -1 }, { cod_amount: 500001 }, { fragile: 'true' }, { created_on: '2025-02-29' }, { city: '' }, { status: 'bad' }, { injected: true }]) assert.throws(() => validate({ ...parcel, ...change }));
  assert.doesNotThrow(() => validate({ ...parcel, weight_kg: 0.01, cod_amount: 500000 }));
  assert.throws(() => validate({ ...events[0], at: '2026-03-15T08:00:00+02:00' }, true));
  assert.throws(() => validate({ ...events[0], at: '2026-03-15T24:00:00Z' }, true));
});
test('Firestore: Explain, фільтри, порядок, курсор та агрегація', async () => {
  const store = new Firestore({ GCP_SA_KEY: '{"project_id":"test"}' });
  const calls = [];
  store.request = async (path, body) => {
    calls.push({ path, body });
    return path.endsWith(':runAggregationQuery') ? [{ result: { aggregateFields: { total: { doubleValue: 100.25 } } } }] : [{ document: { name: 'parcels/abc', fields: fields({ weight_kg: 1.5 }) } }, { explainMetrics: { executionStats: { readOperations: '26' } } }];
  };
  const result = await store.list({ status: 'доставлено', city: 'Київ', limit: 25, offset: 25 });
  assert.equal(result.reads, 26);
  assert.equal(calls[0].body.explainOptions.analyze, true);
  assert.equal(calls[0].body.structuredQuery.offset, 25);
  await store.list({ status: 'доставлено', city: 'Київ', limit: 25, offset: 0, cursor: { weight_kg: 5, id: 'abc' } });
  assert.equal(calls[1].body.structuredQuery.startAt.before, false);
  assert.equal(calls[1].body.structuredQuery.startAt.values[1].referenceValue, 'projects/test/databases/(default)/documents/parcels/abc');
  assert.equal(await store.stats('2026-03-15'), 100.25);
  assert.equal(document({ name: 'a/one', fields: fields({ count: 5, flag: true }) }).count, 5);
});
test('check.mjs проходить через локальний HTTP із тестовим сховищем', async () => {
  const { call } = setup();
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      const response = await call(incoming.url.replace(/^\/api\/parcels/, ''), incoming.method, raw ? JSON.parse(raw) : undefined, incoming.headers.authorization?.slice(7));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch { outgoing.writeHead(500); outgoing.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ['check.mjs'], { env: { ...process.env, API_URL: `http://127.0.0.1:${server.address().port}`, ADMIN_TOKEN: 'secret' } });
    assert.match(stdout, /PASS/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
