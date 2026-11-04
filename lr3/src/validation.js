export const statuses = ['прийнято', 'в дорозі', 'доставлено', 'повернено'];
export function bad(message) { const error = new Error(message); error.status = 400; throw error; }
export function text(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) bad(`${name}: потрібен непорожній рядок до ${max} символів`);
  return value.trim();
}
export function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) bad('дата: очікується коректна YYYY-MM-DD');
  return value;
}
export function status(value) { if (!statuses.includes(value)) bad('status: невідомий стан'); return value; }
export function integer(value, fallback, min, max) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) bad('параметр пагінації поза допустимими межами');
  return Number(value);
}
export function validate(body, event = false) {
  const fields = event ? ['at', 'location', 'note'] : ['tracking', 'weight_kg', 'city', 'status', 'created_on', 'fragile', 'cod_amount'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) bad('невідомі поля або неправильне тіло');
  for (const field of fields) if (!(field in body)) bad(`${field}: обов’язкове поле`);
  if (event) {
    if (typeof body.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{3})?Z$/.test(body.at) || !Number.isFinite(Date.parse(body.at))) bad('at: очікується дата й час UTC з Z');
    day(body.at.slice(0, 10));
    return { at: new Date(body.at).toISOString(), location: text(body.location, 'location'), note: text(body.note, 'note', 2000) };
  }
  for (const [field, min, max] of [['weight_kg', 0.01, 1000], ['cod_amount', 0, 500000]]) {
    if (typeof body[field] !== 'number' || !Number.isFinite(body[field]) || body[field] < min || body[field] > max) bad(`${field}: діапазон ${min}…${max}`);
  }
  if (typeof body.fragile !== 'boolean') bad('fragile: потрібне логічне значення');
  return { ...body, tracking: text(body.tracking, 'tracking'), city: text(body.city, 'city'), status: status(body.status), created_on: day(body.created_on) };
}
