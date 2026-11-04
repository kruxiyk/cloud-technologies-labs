import { mkdir, writeFile } from 'node:fs/promises';
const parcels = Array.from({ length: 30 }, (_, index) => ({
  tracking: `UA-V10-${String(index + 1).padStart(4, '0')}`,
  weight_kg: index < 26 ? 30 - Math.floor(index / 2) : index + 0.5,
  city: index < 26 ? 'Київ' : ['Львів', 'Одеса'][index % 2],
  status: index < 26 ? 'доставлено' : ['прийнято', 'в дорозі', 'повернено', 'доставлено'][index - 26],
  created_on: index % 2 ? '2026-03-16' : '2026-03-15',
  fragile: index % 3 === 0,
  cod_amount: (index + 1) * 100.25,
  events: [
    { at: '2026-03-16T10:00:00Z', location: 'Сортувальний центр', note: 'Посилку оброблено' },
    { at: '2026-03-15T08:00:00Z', location: 'Відділення приймання', note: 'Посилку прийнято' },
  ],
}));
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/parcels.json', import.meta.url), JSON.stringify(parcels, null, 2) + '\n');
