const AUTH_URL = 'https://identitytoolkit.googleapis.com/v1';
const unauthorized = () => ({ status: 401, error: 'потрібен дійсний ID token' });
export async function userFromRequest(request, env) {
  const match = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!match || match[1].length > 16384) return unauthorized();
  if (!env.FIREBASE_API_KEY || env.FIREBASE_API_KEY.startsWith('REPLACE_')) throw new Error('Firebase configuration missing');
  const idToken = match[1];
  const response = await fetch(`${env.AUTH_URL ?? AUTH_URL}/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }) });
  if (response.status === 429 || response.status >= 500) throw new Error('Firebase Authentication unavailable');
  const data = await response.json();
  if (!response.ok) return unauthorized();
  let claims;
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return unauthorized();
    const payload = parts[1].replaceAll('-', '+').replaceAll('_', '/');
    claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload + '='.repeat((4 - payload.length % 4) % 4)), character => character.charCodeAt(0))));
  } catch { return unauthorized(); }
  const user = data.users?.[0];
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now() || !user || user.disabled || typeof user.localId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(user.localId)) return unauthorized();
  if (claims.sub !== user.localId) return unauthorized();
  if (env.FIREBASE_PROJECT_ID && (claims.aud !== env.FIREBASE_PROJECT_ID || claims.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`)) return unauthorized();
  return { uid: user.localId };
}
