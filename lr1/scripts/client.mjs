export const base = (process.env.API_URL ?? process.argv[2] ?? 'http://localhost:8787').replace(/\/$/, '');
export async function request(path, method = 'GET', body, token = process.env.ADMIN_TOKEN) {
  const response = await fetch(base + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), 'cache-control': 'no-cache' }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  return { response, result };
}
