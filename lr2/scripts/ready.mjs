import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
if (!/^AIza[A-Za-z0-9_-]{20,}$/.test(config.vars.FIREBASE_API_KEY)) throw new Error('Спочатку виконайте npm.cmd run configure');
if (config.name !== 'lab1-v10-delivery' || config.vars.FIREBASE_PROJECT_ID !== 'lab1-v10-delivery') throw new Error('Змінено ресурси ЛР1: перевірте конфігурацію');
console.log('Конфігурація готова. Увага: deploy замінює API ЛР1. Виконуйте після захисту ЛР1.');
