let cached;
const encode64 = value => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const json64 = value => encode64(new TextEncoder().encode(JSON.stringify(value)));
async function token(env) {
  const account = JSON.parse(env.GCP_SA_KEY);
  const now = Math.floor(Date.now() / 1000);
  if (cached?.email === account.client_email && cached.expires > now + 60) return cached.value;
  const bytes = Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----|\s/g, '')), character => character.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', bytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const unsigned = `${json64({ alg: 'RS256', typ: 'JWT' })}.${json64({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${encode64(signature)}` }) });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error('Google OAuth failed');
  cached = { email: account.client_email, value: result.access_token, expires: now + Number(result.expires_in) };
  return cached.value;
}
export const value = input => typeof input === 'boolean' ? { booleanValue: input } : typeof input === 'number' ? (Number.isInteger(input) ? { integerValue: String(input) } : { doubleValue: input }) : { stringValue: input };
export const fields = body => Object.fromEntries(Object.entries(body).map(([name, input]) => [name, value(input)]));
export function document(input) {
  return { id: input.name.split('/').at(-1), ...Object.fromEntries(Object.entries(input.fields ?? {}).map(([name, input]) => [name, 'integerValue' in input ? Number(input.integerValue) : Object.values(input)[0]])) };
}
export const where = (name, input) => ({ fieldFilter: { field: { fieldPath: name }, op: 'EQUAL', value: value(input) } });
export const and = (...filters) => ({ compositeFilter: { op: 'AND', filters } });
export class Firestore {
  constructor(env) { this.env = env; this.root = `projects/${JSON.parse(env.GCP_SA_KEY).project_id}/databases/(default)/documents`; }
  async request(path, body, method = body ? 'POST' : 'GET') {
    const response = await fetch(`https://firestore.googleapis.com/v1/${this.root}${path}`, { method, headers: { authorization: `Bearer ${await token(this.env)}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (response.status === 404 && method === 'GET') return null;
    if (!response.ok) { console.error('Firestore', response.status, await response.text()); throw new Error('Firestore unavailable'); }
    return response.json();
  }
  async get(id) { const result = await this.request(`/parcels/${id}`); return result ? document(result) : null; }
  async moderator(uid) { const role = await this.request(`/roles/${encodeURIComponent(uid)}`); return Boolean(role && document(role).role === 'moderator'); }
  async update(id, body) {
    const mask = new URLSearchParams();
    for (const field of Object.keys(body)) mask.append('updateMask.fieldPaths', field);
    mask.set('currentDocument.exists', 'true');
    return document(await this.request(`/parcels/${id}?${mask}`, { fields: fields(body) }, 'PATCH'));
  }
  async create(body, id) { return document(await this.request(id ? `/parcels/${id}/events` : '/parcels', { fields: fields(body) })); }
  async query(query, parent = '') {
    const rows = await this.request(`${parent}:runQuery`, { structuredQuery: query, explainOptions: { analyze: true } });
    const metrics = rows.find(row => row.explainMetrics)?.explainMetrics;
    const reads = metrics?.executionStats?.readOperations;
    if (reads === undefined) throw new Error('Firestore did not return read metrics');
    return { items: rows.filter(row => row.document).map(row => document(row.document)), reads: Number(reads) };
  }
  list({ status, city, limit, offset, cursor, owner_uid }) {
    const filters = [where('status', status), where('city', city)];
    if (owner_uid) filters.push(where('owner_uid', owner_uid));
    const query = { from: [{ collectionId: 'parcels' }], where: and(...filters), orderBy: [{ field: { fieldPath: 'weight_kg' }, direction: 'DESCENDING' }, { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }], limit, offset };
    if (cursor) query.startAt = { before: false, values: [value(cursor.weight_kg), { referenceValue: `${this.root}/parcels/${cursor.id}` }] };
    return this.query(query);
  }
  events(id) { return this.query({ from: [{ collectionId: 'events' }], orderBy: [{ field: { fieldPath: 'at' }, direction: 'DESCENDING' }, { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }] }, `/parcels/${id}`); }
  async stats(date, owner_uid) {
    const filters = [where('status', 'доставлено'), where('created_on', date)];
    if (owner_uid) filters.push(where('owner_uid', owner_uid));
    const rows = await this.request(':runAggregationQuery', { structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: 'parcels' }], where: and(...filters) }, aggregations: [{ alias: 'total', sum: { field: { fieldPath: 'cod_amount' } } }] } });
    const result = rows[0]?.result?.aggregateFields?.total;
    if (!result) throw new Error('Firestore aggregation missing');
    return Number(result.integerValue ?? result.doubleValue ?? 0);
  }
}
