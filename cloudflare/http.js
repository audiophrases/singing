export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireThat(condition, status, message) { if (!condition) throw new HttpError(status, message); }
export function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
export async function bodyJson(request, limit = 1024 * 1024) {
  requireThat(request.headers.get('Content-Type')?.split(';')[0] === 'application/json', 415, 'JSON required.');
  const reader = request.body?.getReader();
  requireThat(reader, 400, 'Request body required.');
  const chunks = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw new HttpError(413, 'Request too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, 'Invalid JSON.'); }
}
export const hash = async (value) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((b) => b.toString(16).padStart(2, '0')).join('');
export const token = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
export const safeId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(id);
export function sameOrigin(request) {
  requireThat(request.headers.get('Origin') === new URL(request.url).origin, 403, 'Same-origin request required.');
  requireThat(!['cross-site', 'none'].includes(request.headers.get('Sec-Fetch-Site')), 403, 'Cross-site request refused.');
}
