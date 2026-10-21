import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const out = new URL('../_site/', import.meta.url);
await mkdir(out, { recursive: true });
for (const name of ['index.html', 'favicon.svg', 'manifest.webmanifest', 'css', 'js', 'sounds', 'fx', 'lab']) {
  await cp(fileURLToPath(new URL(name, root)), fileURLToPath(new URL(name, out)), { recursive: true });
}
console.log('Built static assets in _site (server code, tests and local secrets excluded).');
