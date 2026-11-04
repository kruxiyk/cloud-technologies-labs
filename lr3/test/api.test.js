import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Firestore, fields } from '../src/firestore.js';
import { userFromRequest } from '../src/auth.js';
import { createApp } from '../src/index.js';
import { fixture, parcelBody, eventBody } from './support.mjs';
const list = '/api/parcels?' + new URLSearchParams({ status: 'доставлено', city: 'Київ' });
async function usingFixture(run) { const setup = await fixture(); try { await run(setup); } finally { await setup.close(); } }
test('автентифікація: відсутній, неправильний, підроблений і прострочений токен', () => usingFixture(async setup => {
  assert.equal((await setup.call(list, null)).status, 401);
  for (const token of ['not-a-jwt', 'old-lab1-secret', setup.issue('alice', { exp: 1 }), setup.issue('alice', { exp: null }), setup.issue('alice', { aud: 'another-project' })]) {
    const response = await setup.call(list, 'alice', 'GET', undefined, token);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const token = setup.issue('alice');
  const parts = token.split('.');
  parts[1] = Buffer.from(JSON.stringify({ sub: 'bob', exp: Date.now() })).toString('base64url');
  assert.equal((await setup.call(list, 'alice', 'GET', undefined, parts.join('.'))).status, 401);
}));
test('owner_uid лише з токена; підміна і самопризначення ролі заборонені', () => usingFixture(async setup => {
  const created = await setup.call('/api/parcels', 'alice', 'POST', parcelBody);
  assert.equal(created.status, 201);
  assert.equal((await created.json()).owner_uid, 'alice');
  assert.equal((await setup.call('/api/parcels', 'alice', 'POST', { ...parcelBody, owner_uid: 'bob' })).status, 403);
  assert.equal((await setup.call('/api/parcels', 'alice', 'POST', { ...parcelBody, owner_uid: 'alice' })).status, 201);
  assert.equal((await setup.call('/api/roles', 'alice', 'POST', { uid: 'alice', role: 'moderator' })).status, 404);
  assert.equal((await setup.call('/api/parcels', 'alice', 'POST', { ...parcelBody, role: 'moderator' })).status, 400);
}));
test('власник і модератор: доступ, список, stats, старі записи без власника', () => usingFixture(async setup => {
  const alice = await setup.store.create({ ...parcelBody, owner_uid: 'alice' });
  await setup.store.create({ ...parcelBody, owner_uid: 'bob', cod_amount: 200 });
  const legacy = await setup.store.create({ ...parcelBody, cod_amount: 300 });
  assert.equal((await setup.call(`/api/parcels/${alice.id}`, 'bob')).status, 403);
  assert.equal((await setup.call(`/api/parcels/${alice.id}`, 'mod')).status, 200);
  assert.equal((await setup.call(`/api/parcels/${legacy.id}`, 'alice')).status, 403);
  assert.equal((await setup.call(`/api/parcels/${legacy.id}`, 'mod')).status, 200);
  assert.equal((await (await setup.call(list, 'alice')).json()).items.length, 1);
  assert.equal((await (await setup.call(list, 'mod')).json()).items.length, 3);
  assert.equal((await (await setup.call('/api/parcels/stats?day=2026-10-05', 'alice')).json()).total_cod_amount, 100);
  assert.equal((await (await setup.call('/api/parcels/stats?day=2026-10-05', 'mod')).json()).total_cod_amount, 600);
  assert.equal((await setup.call(`/api/parcels/stats?day=2026-10-05&parcel_id=${alice.id}`, 'bob')).status, 403);
  assert.equal((await setup.call('/api/parcels/stats?day=2026-10-05&parcel_id=missing')).status, 404);
}));
test('дочірні події успадковують права батьківської посилки', () => usingFixture(async setup => {
  const parcel = await setup.store.create({ ...parcelBody, owner_uid: 'alice' });
  const path = `/api/parcels/${parcel.id}/events`;
  assert.equal((await setup.call(path, 'bob', 'POST', eventBody)).status, 403);
  assert.equal((await setup.call(path, 'alice', 'POST', eventBody)).status, 201);
  assert.equal((await setup.call(path, 'mod', 'POST', eventBody)).status, 201);
  assert.equal((await setup.call(path, 'bob')).status, 403);
  assert.equal((await (await setup.call(path, 'mod')).json()).items.length, 2);
}));
test('PATCH перевіряє права, поля й не змінює owner_uid', () => usingFixture(async setup => {
  const parcel = await setup.store.create({ ...parcelBody, owner_uid: 'alice' });
  const path = `/api/parcels/${parcel.id}`;
  assert.equal((await setup.call(path, 'bob', 'PATCH', { cod_amount: 999 })).status, 403);
  assert.equal((await setup.call(path, 'alice', 'PATCH', { weight_kg: 0 })).status, 400);
  assert.equal((await setup.call(path, 'alice', 'PATCH', {})).status, 400);
  assert.equal((await setup.call(path, 'mod', 'PATCH', { owner_uid: 'mod', cod_amount: 1 })).status, 403);
  assert.equal((await setup.call(path, 'alice', 'PATCH', { city: 'Львів' })).status, 200);
  assert.equal((await setup.call(path, 'mod', 'PATCH', { cod_amount: 125 })).status, 200);
  assert.equal((await setup.store.get(parcel.id)).owner_uid, 'alice');
  assert.equal((await setup.store.get(parcel.id)).city, 'Львів');
}));
test('пагінація зі зсувом і курсором не розширює область доступу', () => usingFixture(async setup => {
  for (let index = 0; index < 27; index++) await setup.store.create({ ...parcelBody, weight_kg: index + 1, owner_uid: index === 26 ? 'bob' : 'alice' });
  const first = await (await setup.call(list)).json();
  assert.equal(first.items.length, 25);
  assert.equal(first.next_offset, 25);
  const offset = await (await setup.call(list + '&offset=25')).json();
  const cursor = await (await setup.call(list + '&cursor=' + encodeURIComponent(first.next_cursor))).json();
  assert.deepEqual(offset.items, cursor.items);
  assert.equal(cursor.items.length, 1);
  assert.equal((await setup.call(list + '&cursor=' + encodeURIComponent(first.next_cursor), 'bob')).status, 400);
}));
test('усі відповіді, включно з /login, 400, 401, 403, 404, 405 та 503, мають no-store', () => usingFixture(async setup => {
  for (const [path, uid, method, expected] of [['/login', null, 'GET', 200], ['/login.js', null, 'GET', 200], ['/firebase-config.json', null, 'GET', 200], ['/api/parcels', 'alice', 'GET', 400], [list, null, 'GET', 401], ['/api/parcels/missing', 'alice', 'GET', 404], ['/api/parcels/missing', 'alice', 'DELETE', 405], ['/api/roles/bob', 'alice', 'PATCH', 404]]) {
    const response = await setup.call(path, uid, method);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const app = createApp(() => { throw new Error('test unavailable'); }, async () => ({ uid: 'alice' }));
  const response = await app.fetch(new Request('https://test/api/parcels'), {});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
}));
test('accounts:lookup викликається один раз для кожного переданого токена', () => usingFixture(async setup => {
  const before = setup.lookups();
  const user = await userFromRequest(new Request('https://test/api/parcels', { headers: { authorization: `Bearer ${setup.issue('alice')}` } }), setup.environment);
  assert.equal(user.uid, 'alice');
  assert.equal(setup.lookups(), before + 1);
}));
test('Firestore фільтрує власника у запиті, читає ролі та застосовує updateMask', async () => {
  const store = new Firestore({ GCP_SA_KEY: '{"project_id":"test"}' });
  const calls = [];
  store.request = async (path, body, method) => {
    calls.push({ path, body, method });
    if (path.startsWith('/roles/')) return { name: 'roles/mod', fields: fields({ role: 'moderator' }) };
    if (method === 'PATCH') return { name: 'parcels/one', fields: body.fields };
    if (path.endsWith(':runAggregationQuery')) return [{ result: { aggregateFields: { total: { integerValue: '100' } } } }];
    return [{ explainMetrics: { executionStats: { readOperations: '1' } } }];
  };
  await store.list({ status: 'доставлено', city: 'Київ', limit: 25, offset: 0, owner_uid: 'alice' });
  assert.ok(calls[0].body.structuredQuery.where.compositeFilter.filters.some(filter => filter.fieldFilter.field.fieldPath === 'owner_uid'));
  assert.equal(await store.stats('2026-10-05', 'alice'), 100);
  assert.ok(calls[1].body.structuredAggregationQuery.structuredQuery.where.compositeFilter.filters.some(filter => filter.fieldFilter.field.fieldPath === 'owner_uid'));
  assert.equal(await store.moderator('mod'), true);
  await store.update('one', { cod_amount: 10 });
  assert.equal(calls.at(-1).method, 'PATCH');
  assert.match(calls.at(-1).path, /currentDocument.exists=true/);
  assert.match(calls.at(-1).path, /updateMask.fieldPaths=cod_amount/);
});
test('готовий check2.mjs: Пройшло 24 з 24 через HTTP із тестовими Firebase і сховищем', () => usingFixture(async setup => {
  const directory = await mkdtemp(join(tmpdir(), 'lab2-check-'));
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [resolve('check2.mjs'), setup.base, 'test-api-key'], { cwd: directory, env: { ...process.env, CHECK2_AUTH_URL: setup.base + '/identity' } });
    assert.match(stdout, /Пройшло 24 з 24/);
    assert.equal((stdout.match(/✔/g) ?? []).length, 24);
    const stored = JSON.parse(await readFile(join(directory, '.test-users.json'), 'utf8'));
    assert.equal(Object.keys(stored).length, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
}));
