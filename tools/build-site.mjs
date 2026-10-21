import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const out = new URL('../_site/', import.meta.url);
await mkdir(out, { recursive: true });
for (const name of ['index.html', 'favicon.svg', 'manifest.webmanifest', 'css', 'js', 'sounds', 'fx', 'lab']) {
  await cp(fileURLToPath(new URL(name, root)), fileURLToPath(new URL(name, out)), { recursive: true });
}
// Same app shell, separate teacher entry point. Keep relative asset URLs working
// both in /create/ and when the public static app is hosted in a subdirectory.
await mkdir(new URL('create/', out), { recursive: true });
const shell = await readFile(new URL('index.html', root), 'utf8');
await writeFile(new URL('create/index.html', out), shell.replace(/(href|src)="(favicon\.svg|manifest\.webmanifest|css\/|js\/)/g, '$1="../$2'));
console.log('Built static assets in _site (server code, tests and local secrets excluded).');
