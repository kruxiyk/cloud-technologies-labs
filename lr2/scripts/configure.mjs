import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  const apiKey = (await terminal.question('Firebase Web apiKey (публічний ключ, не токен): ')).trim();
  if (!/^AIza[A-Za-z0-9_-]{20,}$/.test(apiKey)) throw new Error('Неправильний формат Web API key');
  config.vars.FIREBASE_API_KEY = apiKey;
  const source = (await terminal.question('Шлях до .dev.vars ЛР1 (Enter — пропустити копіювання): ')).trim().replace(/^"|"$/g, '');
  if (source) {
    const content = parseEnv((await readFile(resolve(source), 'utf8')).replace(/^\uFEFF/, ''));
    if (!content.GCP_SA_KEY) throw new Error('У джерелі немає GCP_SA_KEY');
    const account = JSON.parse(content.GCP_SA_KEY);
    if (account.project_id !== config.vars.FIREBASE_PROJECT_ID || !account.private_key || !account.client_email) throw new Error('Ключ не відповідає проєкту Firestore');
    await writeFile('.dev.vars', `GCP_SA_KEY='${JSON.stringify(account)}'\n`, { encoding: 'utf8', flag: 'wx' });
  }
  await writeFile('wrangler.jsonc', JSON.stringify(config, null, 2) + '\n');
  console.log('Налаштування збережено. Локальний секрет не містить ADMIN_TOKEN. Деплой не виконувався.');
} finally { terminal.close(); }
