import { json, HttpError, requireThat } from './http.js';
import { authRoutes, authenticate } from './auth.js';
import { songRoutes, uploadAsset, serveMedia } from './songs.js';
import { assignmentRoutes, assignedVersion } from './assignments.js';

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
      if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
      requireThat(env.DB && env.SONGS, 503, 'Cloud storage is not configured.');
      const auth = await authRoutes(request, env, path);
      if (auth) return auth;
      const principal = await authenticate(request, env);
      const upload = /^\/api\/assets\/([a-zA-Z0-9_-]+)$/.exec(path);
      if (upload && request.method === 'PUT') return await uploadAsset(request, env, upload[1], principal);
      const media = /^\/api\/media\/([a-zA-Z0-9_-]+)\/(audio|karaoke|vocals|sourceFile)$/.exec(path);
      if (media && ['GET', 'HEAD'].includes(request.method)) return await serveMedia(request, env, media[1], media[2], principal, assignedVersion);
      return await songRoutes(request, env, path, principal, assignedVersion)
        || await assignmentRoutes(request, env, path, principal) || json({ error: 'Not found.' }, 404);
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(JSON.stringify({ event: 'request_failed', path, error: error.name }));
      return json({ error: error.status ? error.message : 'The service is temporarily unavailable. Please retry.' }, error.status || 503);
    }
  },
  async scheduled(controller, env) {
    // Expiring credentials only; no automatic deletion of song or student media.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM playback_grants WHERE expires_at < ?').bind(Date.now()),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
    ]);
  },
};
