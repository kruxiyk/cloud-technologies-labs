import { readFile } from 'node:fs/promises';
if (!process.env.ID_TOKEN) throw new Error('Задайте ID_TOKEN з /login; не використовуйте спільний секрет ЛР1');
const base = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/, '');
const rows = JSON.parse(await readFile(new URL('./data/parcels.json', import.meta.url), 'utf8'));
async function post(path, body) {
  const response = await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${process.env.ID_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (response.status !== 201) throw new Error(`${response.status}: ${await response.text()}`);
  return response.json();
}
for (const { events, ...parcel } of rows) {
  const created = await post('/api/parcels', parcel);
  for (const event of events) await post(`/api/parcels/${created.id}/events`, event);
}
console.log('Створено 30 власних посилок і 60 подій. Для check2.mjs цей seed не потрібен.');
