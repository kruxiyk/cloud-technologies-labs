import { readFile } from 'node:fs/promises';
import { request } from './client.mjs';
if (!process.env.ADMIN_TOKEN) throw new Error('Задайте ADMIN_TOKEN у середовищі');
const parcels = JSON.parse(await readFile(new URL('../data/parcels.json', import.meta.url), 'utf8'));
for (const { events, ...parcel } of parcels) {
  const { response, result } = await request('/api/parcels', 'POST', parcel);
  if (response.status !== 201) throw new Error(JSON.stringify(result));
  for (const event of events) {
    const created = await request(`/api/parcels/${result.id}/events`, 'POST', event);
    if (created.response.status !== 201) throw new Error(JSON.stringify(created.result));
  }
  console.log(parcel.tracking, result.id);
}
console.log('Створено 30 посилок і 60 подій. Повторний запуск створить дублікати.');
