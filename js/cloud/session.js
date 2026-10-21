let state = { available: false, principal: null, csrf: '', googleClientId: '', error: '' };
const listeners = new Set();
export const cloudSession = () => ({ ...state });
export function onCloudSession(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function update(patch) { state = { ...state, ...patch }; for (const fn of listeners) fn(cloudSession()); }

export async function api(path, { method = 'GET', body, headers = {}, ...options } = {}) {
  const response = await fetch(path, { ...options, method, credentials: 'same-origin',
    signal: options.signal || AbortSignal.timeout(method === 'PUT' ? 120000 : 15000),
    headers: { ...(body && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}),
      ...(!['GET', 'HEAD'].includes(method) && state.csrf ? { 'X-Singing-CSRF': state.csrf } : {}), ...headers },
    body: body instanceof Blob ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get('Content-Type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok || !data) {
    if (response.status === 401) update({ principal: null, csrf: '' });
    throw Object.assign(new Error(data?.error || 'Cloud service is unavailable. Open the cloud-hosted Singing app and try again.'), { status: response.status });
  }
  return data;
}

export async function initCloud() {
  try {
    const config = await api('/api/config');
    update({ available: config.cloud === true, googleClientId: config.googleClientId || '' });
    try { const data = await api('/api/auth/session'); update({ principal: data.principal, csrf: data.csrf }); }
    catch (e) { if (e.status !== 401) update({ error: e.message }); }
  } catch (e) { update({ error: e.message }); }
  return cloudSession();
}
export async function signIn(credentials) {
  const data = await api('/api/auth/login', { method: 'POST', body: credentials });
  update({ principal: data.principal, csrf: data.csrf, error: '' });
  return data.principal;
}
export async function signOut() {
  try { await api('/api/auth/logout', { method: 'POST', body: {} }); }
  finally { update({ principal: null, csrf: '' }); }
}
export function requireTeacher() {
  const s = cloudSession();
  if (!s.available) throw new Error('Cloud storage is not connected. Open the cloud-hosted Singing app to save uploaded songs.');
  if (!['owner', 'teacher'].includes(s.principal?.role)) throw new Error('Sign in as a teacher to save songs to your private cloud library.');
  return s.principal;
}
