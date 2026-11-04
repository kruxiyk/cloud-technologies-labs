import assert from 'node:assert/strict';
import { request } from './client.mjs';
const path = '/api/parcels?' + new URLSearchParams({ status: 'доставлено', city: 'Київ' });
const first = await request(path);
assert.equal(first.response.status, 200);
assert.equal(first.response.headers.get('cache-control'), 'max-age=300');
assert.match(first.response.headers.get('x-read-count'), /^\d+$/);
assert.equal(first.result.items.length, 25, 'Потрібна чиста база з початковими даними');
assert.equal(first.result.next_offset, 25);
const second = await request(path + '&offset=25');
assert.equal(second.response.status, 200);
assert.equal(second.result.items.length, 1);
assert.equal(second.result.next_offset, null);
const combined = [...first.result.items, ...second.result.items];
assert.equal(new Set(combined.map(item => item.id)).size, 26);
for (let index = 1; index < combined.length; index++) {
  assert.ok(combined[index - 1].weight_kg >= combined[index].weight_kg);
}
const cursor = await request(path + '&cursor=' + encodeURIComponent(first.result.next_cursor));
assert.deepEqual(cursor.result.items, second.result.items);
const item = await request(`/api/parcels/${combined[0].id}`);
assert.equal(item.response.status, 200);
const events = await request(`/api/parcels/${combined[0].id}/events`);
assert.equal(events.response.status, 200);
assert.equal(events.result.items.length, 2);
assert.ok(events.result.items[0].at >= events.result.items[1].at);
const stats = await request('/api/parcels/stats?day=2026-03-15');
assert.equal(stats.response.status, 200);
assert.equal(stats.result.total_cod_amount, 16942.25);
assert.equal((await request('/api/parcels/stats?day=2000-01-01')).result.total_cod_amount, 0);
for (const suffix of ['', '?status=bad&city=x', '?status=доставлено&city=Київ&limit=0', '/stats?day=2026-02-30']) assert.equal((await request('/api/parcels' + suffix)).response.status, 400);
assert.equal((await request('/api/parcels/missing')).response.status, 404);
assert.equal((await request('/api/parcels', 'POST', {}, '')).response.status, 401);
for (const method of ['PUT', 'PATCH', 'DELETE']) assert.equal((await request('/api/parcels/any', method)).response.status, 405);
if (process.env.ADMIN_TOKEN) {
  assert.equal((await request('/api/parcels', 'POST', { weight_kg: -1 })).response.status, 400);
  console.log('Авторизована валідація: PASS. Для створення використано окремий seed.mjs.');
}
console.log('PASS: публічні маршрути, два способи пагінації, статистика, події, захист, помилки.');
