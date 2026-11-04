import { request } from './client.mjs';
const path = '/api/parcels?' + new URLSearchParams({ status: 'доставлено', city: 'Київ', limit: '25' });
let cursor;
for (let page = 0; page < 2; page++) {
  const offsetResult = await request(path + `&offset=${page * 25}`);
  const cursorResult = await request(path + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
  for (const [mode, result] of [['offset', offsetResult], ['cursor', cursorResult]]) {
    if (result.response.status !== 200) throw new Error(JSON.stringify(result.result));
    const reads = Number(result.response.headers.get('x-read-count'));
    if (!Number.isFinite(reads) || reads < 1) throw new Error('Немає метрик');
    console.log(JSON.stringify({ page: page + 1, mode, returned: result.result.items.length, reads, requests_in_50000_reads: Math.floor(50000 / reads), measured_at: new Date().toISOString() }));
  }
  cursor = cursorResult.result.next_cursor;
  if (!cursor) break;
}
