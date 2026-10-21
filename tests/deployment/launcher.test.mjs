import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('Windows BAT launchers preserve spaces, ampersands, actions and failure exit codes', { skip: process.platform !== 'win32' }, async (t) => {
  const parent = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(parent, 'singing-launcher-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), parent);
    assert(path.basename(directory).startsWith('singing-launcher-'));
    await rm(directory, { recursive: true, force: true });
  });
  const root = path.join(directory, 'Singing & deployment ! tests');
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await cp(path.join(repository, 'deployment'), path.join(root, 'deployment'), { recursive: true });
  for (const name of ['deploy.bat', 'deploy-fast.bat', 'package.json', 'tools/deploy-launcher.bat', 'tools/deploy-dependencies.cjs']) await cp(path.join(repository, name), path.join(root, name));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  // Satisfy the real dependency checker with metadata only. No installation,
  // Wrangler command or production operation is possible in this fixture.
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    const folder = path.join(root, 'node_modules', name); await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'package.json'), JSON.stringify({ version }));
  }
  await writeFile(path.join(root, 'tools/deploy-cli.mjs'), `import {writeFileSync} from 'node:fs'; writeFileSync(process.env.SINGING_LAUNCHER_RESULT,JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)})); process.exitCode=17;`);
  const resultFile = path.join(root, 'launcher-result.json');
  for (const [name, args] of [['deploy.bat', ['menu']], ['deploy-fast.bat', ['update', '--yes']], ['deployment/01-prepare.bat', ['prepare']], ['deployment/02-deploy.bat', ['deploy']], ['deployment/03-verify-and-open.bat', ['verify']], ['deployment/04-google-login-setup.bat', ['google']]]) {
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/v:off', '/s', '/c', `""${path.join(root, name)}""`], {
      cwd: directory, env: { ...process.env, SINGING_DEPLOY_NO_PAUSE: '1', SINGING_LAUNCHER_RESULT: resultFile },
      shell: false, windowsVerbatimArguments: true, windowsHide: true, encoding: 'utf8', timeout: 20000,
    });
    assert.equal(result.status, 17, `${name}: ${result.stdout}\n${result.stderr}`);
    const record = JSON.parse(await readFile(resultFile, 'utf8'));
    assert.equal(record.cwd.toLowerCase(), root.toLowerCase());
    assert.deepEqual(record.args, args);
  }
});
