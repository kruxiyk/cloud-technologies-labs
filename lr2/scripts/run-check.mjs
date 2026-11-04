import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
if (config.vars.FIREBASE_API_KEY.startsWith('REPLACE_')) throw new Error('Спочатку налаштуйте Firebase Web apiKey');
const base = process.argv[2] ?? process.env.API_URL ?? 'http://localhost:8787';
const result = spawnSync(process.execPath, ['check2.mjs', base, config.vars.FIREBASE_API_KEY], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
