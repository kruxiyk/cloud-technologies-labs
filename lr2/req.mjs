import { readFile } from 'node:fs/promises';
const [method, url, bodyFile] = process.argv.slice(2);
if (!method || !url) throw new Error('node req.mjs GET <URL> [body.json]');
const response = await fetch(url, { method, headers: { ...(process.env.ID_TOKEN ? { authorization: `Bearer ${process.env.ID_TOKEN}` } : {}), ...(bodyFile ? { 'content-type': 'application/json' } : {}) }, body: bodyFile ? await readFile(bodyFile, 'utf8') : undefined });
console.log(`${response.status} cache-control: ${response.headers.get('cache-control')} x-read-count: ${response.headers.get('x-read-count') ?? '-'}`);
console.log(await response.text());
