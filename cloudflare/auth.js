import { bodyJson, hash, token, json, requireThat, HttpError, sameOrigin } from './http.js';

const COOKIE = '__Host-singing';
const TTL = 8 * 60 * 60 * 1000;
export function sessionCookie(request) {
  return request.headers.get('Cookie')?.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
}
function cookie(value, seconds) { return `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`; }
export async function identity(env, path, body) {
  requireThat(env.IDENTITY, 503, 'Shared sign-in service is not connected.');
  const response = await env.IDENTITY.fetch(new Request(`https://classroom.internal/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  let result;
  try { result = await response.json(); } catch { throw new HttpError(503, 'Sign-in service is unavailable.'); }
  requireThat(response.ok, response.status, result.error || 'Sign-in refused.');
  return result;
}
export async function authenticate(request, env) {
  const credential = sessionCookie(request);
  requireThat(credential.length > 20 && credential.length <= 8192, 401, 'Sign in to Singing first.');
  const sessionHash = await hash(credential);
  const session = await env.DB.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(sessionHash, Date.now()).first();
  requireThat(session, 401, 'Your session expired. Sign in again.');
  // Rechecks current roles, enrollment and workspace revocation in PinPlay.
  const { principal } = await identity(env, 'verify', { credential });
  requireThat(principal?.id === session.principal_id && principal.role === session.role, 401, 'Sign in again.');
  if (!['GET', 'HEAD'].includes(request.method)) {
    sameOrigin(request);
    requireThat(request.headers.get('X-Singing-CSRF') === session.csrf, 403, 'Reload the page and try again.');
  }
  return { ...principal, sessionHash, csrf: session.csrf, credential };
}
export const teacher = (principal) => requireThat(['owner', 'teacher'].includes(principal.role), 403, 'Teacher access required.');

export async function authRoutes(request, env, path) {
  if (path === '/api/config' && request.method === 'GET') {
    const data = await identity(env, 'config', {});
    return json({ cloud: true, googleClientId: data.googleClientId || '' });
  }
  if (path === '/api/auth/login' && request.method === 'POST') {
    sameOrigin(request);
    if (env.AUTH_RL) requireThat((await env.AUTH_RL.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' })).success, 429, 'Too many sign-in attempts. Try again shortly.');
    const body = await bodyJson(request, 16384);
    const { credential, principal } = await identity(env, 'login', { ...body, ip: request.headers.get('CF-Connecting-IP') || 'local' });
    requireThat(credential && principal?.id && ['owner', 'teacher', 'student'].includes(principal.role), 503, 'Invalid sign-in response.');
    const csrf = token();
    await env.DB.prepare('INSERT OR REPLACE INTO sessions (token_hash, principal_id, role, csrf, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await hash(credential), principal.id, principal.role, csrf, Date.now() + TTL).run();
    return json({ principal, csrf }, 200, { 'Set-Cookie': cookie(credential, TTL / 1000) });
  }
  if (path === '/api/auth/session' && request.method === 'GET') {
    const principal = await authenticate(request, env);
    const { credential, sessionHash, ...publicPrincipal } = principal;
    return json({ principal: publicPrincipal, csrf: principal.csrf });
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    sameOrigin(request);
    const sessionHash = await hash(sessionCookie(request));
    const session = await env.DB.prepare('SELECT csrf FROM sessions WHERE token_hash = ?').bind(sessionHash).first();
    if (session) requireThat(request.headers.get('X-Singing-CSRF') === session.csrf, 403, 'Reload the page and try again.');
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(sessionHash).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
  }
  return null;
}
