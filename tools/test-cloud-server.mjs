// Local integration fixture only. Never packaged into the deployed site.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const modules = [];
async function collect(directory) {
  for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
    const path = directory + entry.name;
    if (entry.isDirectory() && !['vendor', 'data', 'games', 'views'].includes(entry.name)) await collect(`${path}/`);
    else if (entry.isFile() && /\.js$/.test(path)) modules.push({ type: 'ESModule', path: fileURLToPath(new URL(path, root)) });
  }
}
await collect('cloudflare/'); await collect('js/');
const entry = fileURLToPath(new URL('cloudflare/worker.js', root));
modules.sort((a, b) => a.path === entry ? -1 : b.path === entry ? 1 : 0);
const sessions = new Map();
const mf = new Miniflare(convertV4MiniflareOptions({ port: 8788, host: '127.0.0.1', workers: [{
  name: 'singing', modulesRoot: fileURLToPath(root), modules,
  compatibilityDate: '2026-10-21', d1Databases: ['DB'], r2Buckets: ['SONGS'],
  serviceBindings: { ASSETS: async (request) => {
    const path = new URL(request.url).pathname === '/' ? 'index.html' : new URL(request.url).pathname.slice(1);
    if (path.split('/').includes('..')) return new Response('Not found', { status: 404 });
    try {
      const contents = await readFile(new URL(`_site/${path}`, root));
      const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.html') ? 'text/html' : path.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
      return new Response(contents, { headers: { 'Content-Type': type } });
    } catch { return new Response('Not found', { status: 404 }); }
  }, IDENTITY: async (request) => {
    const path = new URL(request.url).pathname; const body = await request.json();
    if (path === '/config') return Response.json({ googleClientId: '' });
    if (path === '/login') {
      const name = body.password || body.googleIdToken;
      if (!['teacher', 'student', 'outsider'].includes(name)) return Response.json({ error: 'Wrong test credentials.' }, { status: 401 });
      const credential = crypto.randomUUID() + crypto.randomUUID();
      const principal = { id: name, role: name === 'teacher' ? 'owner' : 'student', displayName: name, classIds: [name === 'outsider' ? 'class_b' : 'class_a'] };
      sessions.set(credential, principal); return Response.json({ credential, principal });
    }
    const principal = sessions.get(body.credential);
    if (!principal) return Response.json({ error: 'Sign in again.' }, { status: 401 });
    if (path === '/classes') return Response.json({ classes: [{ id: 'class_a', name: 'Class A' }] });
    if (path === '/roster') return Response.json({ students: [
      { id: 'student', displayName: 'student', className: 'Class A' },
      { id: 'not-started', displayName: 'Not started student', className: 'Class A' },
    ] });
    if (path === '/teachers') return Response.json({ teachers: [] });
    return Response.json({ principal });
  } },
}] }));
const db = await mf.getD1Database('DB');
for (const filename of ['0001_cloud_library.sql', '0002_assignments.sql']) {
  const sql = await readFile(new URL(`cloudflare/migrations/${filename}`, root), 'utf8');
  for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run();
}
console.log(`Local isolated cloud fixture ready at ${await mf.ready}`);
process.on('SIGINT', async () => { await mf.dispose(); process.exit(0); });
