// Час холодного (перший запит до сплячого сервісу) і теплих запитів: node cold.mjs <адреса> [шлях]
const [url, path = "/"] = process.argv.slice(2);
if (!url) { console.log("Використання: node cold.mjs <адреса> [шлях]"); process.exit(1); }
const WARM = 5;                              // скільки теплих запитів після першого
const TIMEOUT_MS = 180_000;                  // Render будить сервіс до хвилини; довше — збій, а не холодний старт

async function timed() {
  const start = performance.now();
  const r = await fetch(`${url.replace(/\/$/, "")}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  await r.arrayBuffer();                     // час до кінця тіла відповіді
  return [Math.round(performance.now() - start), r.status];
}

console.log(`${new Date().toISOString()} ${url}${path}`);
const [first, status] = await timed();
console.log(`перший (холодний, якщо сервіс спав): ${first} мс, код ${status}`);
const warm = [];
for (let i = 0; i < WARM; i++) warm.push((await timed())[0]);
console.log(`теплі: ${warm.join(", ")} мс; медіана ${[...warm].sort((a, b) => a - b)[Math.floor(WARM / 2)]} мс`);
