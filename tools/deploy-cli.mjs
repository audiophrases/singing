import { spawn } from 'node:child_process';
import { open, mkdir, readFile, unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Deployment, assertSingingBindings, applicationUrl } from './deployment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const help = `Singing deployment

Double-click deploy.bat for the menu, or use the numbered files in deployment/.

  prepare   Install dependencies via the BAT launcher, prepare an isolated
            PinPlay checkout, run tests, and dry-run both Workers.
  deploy    Prepare, sign in, create/reuse private Singing storage, migrate
            Singing D1, release the PinPlay adapter, and deploy Singing.
  verify    Check private bucket access and public application health.
  google    Show the app origin to allow and open the Google credentials page.

Advanced: node tools/deploy-cli.mjs deploy --yes skips the final typed
confirmation. It still performs all checks. Credentials stay with Wrangler.
SINGING_DEPLOY_URL can supply the public app HTTPS origin on another computer.
SINGING_DEPLOY_NO_BROWSER=1 disables opening the app after deploy/verify.
`;

export function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root, env: options.env || process.env, shell: false,
      windowsHide: true, stdio: options.interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => reject(command === 'git' && error.code === 'ENOENT'
      ? new Error('Git was not found. Install Git for Windows, then run the BAT file again.') : error));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function lock(directory) {
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'deployment.lock');
  try {
    const file = await open(filename, 'wx');
    await file.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); await file.close();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let previous;
    try { previous = JSON.parse(await readFile(filename, 'utf8')); }
    catch { throw new Error('Cannot read .deployment/deployment.lock. Check that no deployment is running before removing that lock file.'); }
    if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0) throw new Error('The deployment lock is invalid. Check it before retrying.');
    let running = true;
    try { process.kill(previous.pid, 0); } catch (e) { if (e.code === 'ESRCH') running = false; }
    if (running) throw new Error(`Another deployment helper is running (PID ${previous.pid}). Close it or wait for it to finish.`);
    await unlink(filename); return lock(directory);
  }
  return () => unlink(filename);
}

function openBrowser(url) {
  if (process.env.SINGING_DEPLOY_NO_BROWSER === '1') return;
  const executable = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(executable, args, { shell: false, windowsHide: true, detached: true, stdio: 'ignore' });
  child.on('error', () => {}); child.unref();
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(help); return; }
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Install Node.js 22 or later, then run the BAT file again.');
  let action = argv[0] || 'menu';
  if (!['menu', 'prepare', 'deploy', 'verify', 'google'].includes(action) || argv.some((arg, i) => i > 0 && arg !== '--yes')) throw new Error('Unknown option. Run node tools/deploy-cli.mjs --help .');
  let prompt;
  const ask = async (question) => {
    if (!process.stdin.isTTY) throw new Error('This step needs an interactive terminal. Use the BAT launcher, or explicitly use deploy --yes for an automated release.');
    prompt ||= createInterface({ input: process.stdin, output: process.stdout });
    return prompt.question(question);
  };
  let releaseLock;
  try {
    if (action === 'menu') {
      console.log('Singing deployment\n\n1. Deploy or update Singing (recommended)\n2. Prepare and test only\n3. Verify deployment and open app\n4. Open Google login setup\nQ. Exit\n');
      const choice = (await ask('Choose 1, 2, 3, 4 or Q: ')).trim().toLowerCase();
      if (choice === 'q') return;
      action = { 1: 'deploy', 2: 'prepare', 3: 'verify', 4: 'google' }[choice];
      if (!action) throw new Error('Choose one of the listed menu options.');
    }
    releaseLock = await lock(path.join(root, '.deployment'));
    // Use the pinned Wrangler parser for both JSONC and TOML. No configuration
    // formats or shell command strings are reimplemented in the launchers.
    const { experimental_readRawConfig } = await import('wrangler');
    const deployment = await new Deployment({ root, run: execute, readConfig: (config) => experimental_readRawConfig({ config }).rawConfig, ask }).load();
    if (action === 'prepare') await deployment.prepare();
    else if (action === 'deploy') {
      await deployment.deploy({ yes: argv.includes('--yes') });
      openBrowser(deployment.state.url);
    } else if (action === 'google') {
      const url = applicationUrl(process.env.SINGING_DEPLOY_URL || deployment.state.url || await ask('Singing HTTPS address: '));
      console.log(`In the existing Google OAuth web client, add this Authorized JavaScript origin:\n\n  ${url}\n\nKeep its existing origins. Save, then test Google sign-in in Singing.\nThe deployment notes include the public client ID: .deployment/NEXT-STEPS.txt`);
      openBrowser('https://console.cloud.google.com/apis/credentials');
    } else {
      if (!deployment.state.accountId || !deployment.state.databaseId) throw new Error('No deployment record exists here yet. Run 02-deploy.bat first.');
      deployment.accountId = deployment.state.accountId;
      deployment.pinplayFile = path.join(deployment.directory, 'pinplay.production.json');
      await deployment.authenticate(); await deployment.privateBucket();
      const live = await deployment.inspect('singing');
      if (!live) throw new Error('Singing is not deployed in this account.');
      assertSingingBindings(live.version, deployment.state.databaseId);
      const url = await deployment.verify(); openBrowser(url);
    }
  } finally { prompt?.close(); if (releaseLock) await releaseLock(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`\nStopped: ${error.message}\nFix the issue and run the same BAT file again. Existing resource IDs and completed release steps are retained in .deployment/.`);
    process.exitCode = 1;
  });
}
