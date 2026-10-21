import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export const PINPLAY_REPOSITORY = 'https://github.com/audiophrases/pinplay.git';
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const PATCH_FILES = ['cloudflare/classroom-entry.mjs', 'cloudflare/classroom-identity.mjs', 'cloudflare/worker.js', 'cloudflare/wrangler.toml', 'tests/classroom-identity.test.mjs'];
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const plain = (text = '') => text.replace(/\x1b\[[0-9;]*m/g, '').trim();
export function parseJson(output, label) {
  try { return JSON.parse(plain(output)); } catch { throw new Error(`${label} did not return valid JSON. Stop and check the installed Wrangler version.`); }
}
export function scopedPath(root, ...parts) {
  const result = path.resolve(root, ...parts), relative = path.relative(path.resolve(root), result);
  ensure(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative), 'Deployment path must stay inside its workspace.');
  return result;
}
export function requireAccount(who, accountId, environmentAccount) {
  ensure(/^[a-f0-9]{32}$/i.test(accountId || ''), 'PinPlay must name its Cloudflare account_id explicitly.');
  ensure(!environmentAccount || environmentAccount === accountId, 'CLOUDFLARE_ACCOUNT_ID points to another account. Remove or correct it before deployment.');
  ensure(who.loggedIn && who.accounts?.some((account) => account.id === accountId), 'The signed-in Cloudflare identity cannot access PinPlay’s configured account.');
  return accountId;
}
export function activeVersion(deployment) {
  ensure(deployment?.versions?.length === 1 && deployment.versions[0].percentage === 100 && UUID.test(deployment.versions[0].version_id), 'Expected one production version at 100%. Finish the current gradual rollout before deploying Singing.');
  return deployment.versions[0].version_id;
}
export function latestVersion(versions) {
  const items = Array.isArray(versions) ? versions : versions?.items;
  ensure(Array.isArray(items) && items.length, 'Cloudflare returned no Worker versions.');
  const sorted = [...items].sort((a, b) => Number(b.number) - Number(a.number));
  ensure(UUID.test(sorted[0].id), 'Cloudflare returned an invalid version identifier.');
  return sorted[0].id;
}
export function assertLatest(active, latest, pending) {
  ensure(latest === active || latest === pending?.versionId && pending.baselineVersion === active, 'There is an unrecognized staged Worker version. Deploy or discard it in Cloudflare before continuing; its bindings must not be inherited silently.');
}
export function bucketNames(output) {
  const text = plain(output);
  const names = [...text.matchAll(/^name:\s+([a-z0-9][a-z0-9-]*)\s*$/gm)].map((m) => m[1]);
  ensure(names.length || !text || /no buckets/i.test(text), 'Could not read the R2 bucket list. No bucket was created.');
  return names;
}
export function assertPrivateBucket(devUrlOutput, domainsOutput) {
  ensure(plain(devUrlOutput).includes('Public access via the r2.dev URL is disabled.'), 'The Singing bucket has public or unrecognized r2.dev access. Disable public access in R2 before continuing.');
  ensure(plain(domainsOutput).includes('There are no custom domains connected to this bucket.'), 'The Singing bucket has public custom domains. Remove them in R2 before continuing.');
}
export function deploymentRecord(ndjson, type, worker) {
  const rows = ndjson.trim().split(/\r?\n/).filter(Boolean).map((line) => parseJson(line, 'Wrangler structured output'));
  const row = rows.findLast((entry) => entry.type === type && entry.worker_name === worker);
  ensure(row, `Wrangler did not confirm ${type} for ${worker}.`);
  if (type !== 'version-deploy') ensure(UUID.test(row.version_id || '') && row.version_id !== ZERO_UUID, 'Wrangler did not return a deployed version ID. A dry run is not a deployment.');
  else ensure(UUID.test(row.deployment_id || ''), 'Wrangler did not confirm the production deployment ID.');
  return row;
}
export function applicationUrl(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Enter the public HTTPS address of the Singing app.'); }
  ensure(url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Use only the Singing HTTPS origin, for example https://singing.example.workers.dev .');
  return url.origin;
}
export function singingConfig(base, root, accountId, databaseId) {
  ensure(UUID.test(databaseId) && databaseId !== ZERO_UUID, 'Set a real Singing database UUID before any remote migration or deployment.');
  const config = structuredClone(base); delete config.$schema;
  ensure(config.name === 'singing' && config.d1_databases?.length === 1 && config.d1_databases[0].binding === 'DB' && config.d1_databases[0].database_name === 'singing', 'Expected Singing’s own Worker and D1 database, both named singing.');
  ensure(config.r2_buckets?.length === 1 && config.r2_buckets[0].binding === 'SONGS' && config.r2_buckets[0].bucket_name === 'singing-private-songs', 'Expected the dedicated singing-private-songs bucket. Never reuse PinPlay’s public media bucket.');
  ensure(config.services?.length === 1 && config.services[0].binding === 'IDENTITY' && config.services[0].service === 'pinplay-api' && config.services[0].entrypoint === 'ClassroomIdentity', 'Expected the service-only PinPlay ClassroomIdentity binding.');
  config.account_id = accountId; config.main = path.resolve(root, config.main);
  config.assets.directory = path.resolve(root, config.assets.directory);
  config.d1_databases[0].database_id = databaseId;
  config.d1_databases[0].migrations_dir = path.resolve(root, config.d1_databases[0].migrations_dir);
  config.workers_dev ??= true; config.preview_urls ??= false;
  return config;
}
export function pinplayConfig(raw, configDirectory) {
  ensure(raw.name === 'pinplay-api' && raw.main === 'classroom-entry.mjs', 'The prepared PinPlay config must use the ClassroomIdentity companion entrypoint.');
  ensure(raw.migrations?.length === 1 && raw.migrations[0].tag === 'v1' && raw.migrations[0].new_sqlite_classes?.join(',') === 'QuizRoom', 'PinPlay has unrelated Durable Object migrations. Release those through PinPlay before using this helper.');
  const config = structuredClone(raw); delete config.$schema;
  config.main = path.resolve(configDirectory, raw.main);
  // Versions upload/deploy preserves routes, domains and cron triggers. Omitting
  // these optional version settings also preserves their deployed values.
  for (const key of ['observability', 'logpush', 'tail_consumers', 'streaming_tail_consumers']) delete config[key];
  return config;
}
export function assertPinplayBindings(version, local) {
  ensure(version.resources?.script_runtime?.migration_tag === 'v1', 'PinPlay’s live Durable Object migration tag changed. Stop and review its deployment first.');
  ensure(version.resources.script_runtime.compatibility_date === local.compatibility_date, 'PinPlay’s live compatibility date differs from this checkout. Reconcile the source before deployment.');
  const expected = new Map([
    ...(local.r2_buckets || []).map((b) => [b.binding, { type: 'r2_bucket', bucket_name: b.bucket_name }]),
    ...(local.durable_objects?.bindings || []).map((b) => [b.name, { type: 'durable_object_namespace', class_name: b.class_name, script_name: b.script_name || local.name }]),
    ...(local.unsafe?.bindings || []).map((b) => [b.name, { type: b.type, namespace_id: String(b.namespace_id), simple: b.simple }]),
  ]);
  const names = new Set();
  for (const binding of version.resources.bindings || []) {
    names.add(binding.name);
    if (['plain_text', 'json', 'secret_text'].includes(binding.type)) continue;
    const intended = expected.get(binding.name);
    ensure(intended && intended.type === binding.type, `PinPlay binding ${binding.name} is missing or different in the local config. No upload was performed.`);
    for (const [field, value] of Object.entries(intended)) {
      const actual = field === 'script_name' ? binding[field] || local.name : field === 'namespace_id' ? String(binding[field]) : binding[field];
      const matches = field === 'simple' ? actual?.limit === value.limit && actual?.period === value.period : JSON.stringify(actual) === JSON.stringify(value);
      ensure(matches, `PinPlay binding ${binding.name}.${field} differs from production. Reconcile it first.`);
    }
    expected.delete(binding.name);
  }
  ensure(!expected.size, 'The local PinPlay config adds resource bindings that are absent in production.');
  ensure(names.has('CREATE_PASSWORD_HASH') && (names.has('STUDENT_SESSION_KEY') || names.has('CREATOR_SIGNING_KEY')), 'PinPlay must already have its teacher password hash and session signing secret configured. This helper never copies or creates those secrets.');
}
export function assertSingingBindings(version, databaseId) {
  const bindings = new Map((version.resources?.bindings || []).map((b) => [b.name, b]));
  ensure(bindings.get('DB')?.type === 'd1' && bindings.get('DB').id === databaseId, 'The live Singing Worker uses another D1 database. No code was replaced.');
  ensure(bindings.get('SONGS')?.type === 'r2_bucket' && bindings.get('SONGS').bucket_name === 'singing-private-songs', 'The live Singing Worker uses another media bucket.');
  ensure(bindings.get('IDENTITY')?.type === 'service' && bindings.get('IDENTITY').service === 'pinplay-api' && bindings.get('IDENTITY').entrypoint === 'ClassroomIdentity', 'The live Singing identity binding differs.');
  ensure(bindings.get('AUTH_RL')?.type === 'ratelimit' && String(bindings.get('AUTH_RL').namespace_id) === '1002', 'The live Singing rate-limit binding differs.');
  ensure(bindings.get('ASSETS')?.type === 'assets', 'The live Singing assets binding differs.');
  for (const b of bindings.values()) ensure(['DB', 'SONGS', 'IDENTITY', 'AUTH_RL', 'ASSETS'].includes(b.name) || ['plain_text', 'json', 'secret_text'].includes(b.type), `Unexpected Singing binding ${b.name}. Reconcile its config first.`);
}

export class Deployment {
  constructor({ root, run, readConfig, ask, log = console.log, fetch = globalThis.fetch, environment = process.env }) {
    this.root = path.resolve(root); this.directory = scopedPath(this.root, '.deployment');
    this.run = run; this.readConfig = readConfig; this.ask = ask; this.log = log; this.fetch = fetch; this.environment = environment;
    this.state = { version: 1 }; this.accountId = '';
    this.wrangler = path.join(this.root, 'node_modules/wrangler/bin/wrangler.js');
  }
  async load() {
    await mkdir(this.directory, { recursive: true });
    try { this.state = JSON.parse(await readFile(path.join(this.directory, 'state.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('Cannot read .deployment/state.json. Restore it before continuing.'); }
    ensure(this.state.version === 1, 'Unsupported deployment state version.');
    this.base = await this.readConfig(path.join(this.root, 'wrangler.jsonc'));
    return this;
  }
  async checkpoint() {
    const file = path.join(this.directory, 'state.json');
    await writeFile(`${file}.tmp`, JSON.stringify(this.state, null, 2) + '\n'); await rename(`${file}.tmp`, file);
  }
  async checked(command, args, options = {}) {
    const result = await this.run(command, args, { cwd: this.root, ...options });
    ensure(result.code === 0, `${options.label || command} failed (exit ${result.code}).${this.diagnostic(result)}`);
    return result;
  }
  diagnostic(result) {
    // Never dump captured whoami/version JSON or inherited variable values.
    const lines = plain(result.stderr || '').split(/\r?\n/).filter((line) => /\[ERROR\]|\[code:|Error:|fatal:/.test(line)).slice(0, 4);
    let text = lines.length ? '\n' + lines.join('\n') : '';
    for (const [name, value] of Object.entries(this.environment)) if (value && /TOKEN|SECRET|PASSWORD|API_KEY/i.test(name)) text = text.split(value).join('[redacted]');
    return text;
  }
  node(args, options) { return this.checked(process.execPath, args, options); }
  async wr(args, { label = args.slice(0, 3).join(' '), allowFailure = false, interactive = false, output = false, config = this.configFile, ...options } = {}) {
    const outputFile = output ? path.join(this.directory, `command-${randomUUID()}.ndjson`) : null;
    const environment = { ...this.environment, NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false', ...(this.accountId ? { CLOUDFLARE_ACCOUNT_ID: this.accountId } : {}), ...(outputFile ? { WRANGLER_OUTPUT_FILE_PATH: outputFile } : {}) };
    // An ambient output path would append command records to someone else's file.
    if (!outputFile) delete environment.WRANGLER_OUTPUT_FILE_PATH;
    const result = await this.run(process.execPath, [this.wrangler, ...args, ...(config ? ['--config', config] : [])], { cwd: this.root, env: environment, interactive, ...options });
    ensure(allowFailure || result.code === 0, `${label} failed (exit ${result.code}).${this.diagnostic(result)}`);
    if (outputFile && result.code === 0) result.records = await readFile(outputFile, 'utf8');
    return result;
  }
  async git(args, cwd = this.root, allowFailure = false) {
    const result = await this.run('git', args, { cwd });
    ensure(allowFailure || result.code === 0, `Git ${args[0]} failed.${this.diagnostic(result)}`); return result;
  }
  async sourceHashes(directory) {
    const files = (await this.git(['ls-files', '-z', 'cloudflare'], directory)).stdout.split('\0').filter(Boolean);
    const hashes = {};
    for (const name of [...new Set([...files, ...PATCH_FILES])].sort()) hashes[name] = digest(await readFile(scopedPath(directory, name)));
    return hashes;
  }
  async prepareSource() {
    this.log('Preparing the PinPlay identity adapter in an isolated checkout…');
    await this.git(['--version']);
    const remote = plain((await this.git(['ls-remote', PINPLAY_REPOSITORY, 'refs/heads/main'])).stdout).split(/\s/)[0];
    ensure(/^[a-f0-9]{40}$/.test(remote), 'Could not identify PinPlay main.');
    const patch = path.join(this.root, 'integrations/pinplay-classroom.patch');
    const patchHash = digest(await readFile(patch));
    let source = this.state.source;
    if (source?.commit === remote && source.patchHash === patchHash) {
      source.path = scopedPath(this.directory, path.relative(this.directory, source.path));
      ensure(plain((await this.git(['rev-parse', 'HEAD'], source.path)).stdout) === remote, 'The managed PinPlay checkout moved to another commit.');
      ensure(JSON.stringify(await this.sourceHashes(source.path)) === JSON.stringify(source.hashes), 'The managed PinPlay source was edited. Preserve those edits elsewhere and remove its source entry from .deployment/state.json to prepare a fresh checkout.');
    } else {
      const directory = scopedPath(this.directory, 'pinplay', `${remote.slice(0, 12)}-${randomUUID().slice(0, 8)}`);
      await mkdir(path.dirname(directory), { recursive: true });
      await this.git(['clone', '--depth', '1', '--branch', 'main', PINPLAY_REPOSITORY, directory]);
      ensure(plain((await this.git(['rev-parse', 'HEAD'], directory)).stdout) === remote, 'PinPlay main changed during preparation. Run this step again.');
      const applicable = await this.git(['apply', '--check', patch], directory, true);
      if (applicable.code === 0) await this.git(['apply', patch], directory);
      else ensure((await this.git(['apply', '--reverse', '--check', patch], directory, true)).code === 0, 'The PinPlay companion patch conflicts with current main. Resolve the integration before deploying.');
      source = { path: directory, commit: remote, patchHash, hashes: await this.sourceHashes(directory) };
      this.state.source = source; await this.checkpoint();
    }
    const changed = plain((await this.git(['diff', '--name-only', 'HEAD'], source.path)).stdout).split(/\r?\n/).filter(Boolean);
    ensure(changed.every((file) => PATCH_FILES.includes(file)), 'The managed PinPlay checkout contains unrelated changes.');
    this.pinplay = pinplayConfig(await this.readConfig(path.join(source.path, 'cloudflare/wrangler.toml')), path.join(source.path, 'cloudflare'));
    this.accountId = this.pinplay.account_id;
    // Validate names/bindings during preparation, before any remote writes.
    singingConfig(this.base, this.root, this.accountId, '11111111-1111-4111-8111-111111111111');
    ensure(!this.environment.CLOUDFLARE_ACCOUNT_ID || this.environment.CLOUDFLARE_ACCOUNT_ID === this.accountId, 'CLOUDFLARE_ACCOUNT_ID points to another account.');
    ensure(!this.state.accountId || this.state.accountId === this.accountId, 'The saved deployment belongs to another Cloudflare account.');
    this.state.accountId = this.accountId;
    this.pinplayFile = path.join(this.directory, 'pinplay.production.json');
    await writeFile(this.pinplayFile, JSON.stringify(this.pinplay, null, 2) + '\n');
    await this.checkpoint();
  }
  async prepare() {
    await this.prepareSource();
    const tests = (await readdir(path.join(this.root, 'tests'))).filter((name) => name.endsWith('.test.js')).map((name) => path.join('tests', name));
    const cloudTests = (await readdir(path.join(this.root, 'tests/cloud'))).filter((name) => name.endsWith('.test.mjs')).map((name) => path.join('tests/cloud', name));
    const deploymentTests = (await readdir(path.join(this.root, 'tests/deployment'))).filter((name) => name.endsWith('.test.mjs')).map((name) => path.join('tests/deployment', name));
    for (const [label, files] of [['Singing tests', tests], ['Cloud storage and assignment tests', cloudTests], ['Deployment automation tests', deploymentTests]]) {
      this.log(`Running ${label}…`); await this.node(['--test', '--test-reporter=dot', ...files], { label });
    }
    this.log('Checking shared PinPlay authentication…');
    await this.node(['--test', 'tests/classroom-identity.test.mjs'], { cwd: this.state.source.path, label: 'PinPlay identity tests' });
    this.log('Building the site and both Worker bundles…');
    await this.node(['tools/build-site.mjs']);
    await this.wr(['deploy', '--dry-run'], { config: path.join(this.root, 'wrangler.jsonc'), label: 'Singing dry run' });
    await this.wr(['versions', 'upload', '--dry-run', '--keep-vars'], { config: this.pinplayFile, label: 'PinPlay dry run' });
    this.log('Preparation passed. No production resources were changed.');
  }
  async authenticate() {
    let result = await this.wr(['whoami', '--json'], { allowFailure: true, config: this.pinplayFile });
    if (result.code !== 0) {
      ensure(!this.environment.CLOUDFLARE_API_TOKEN && !this.environment.CLOUDFLARE_API_KEY, 'Cloudflare API credentials are configured but authentication failed. Correct them outside this tool, or remove them to use browser login.');
      this.log('Sign in to Cloudflare in the browser window…');
      await this.wr(['login'], { interactive: true, config: this.pinplayFile });
      result = await this.wr(['whoami', '--json'], { config: this.pinplayFile });
    }
    const who = parseJson(result.stdout, 'Cloudflare identity');
    requireAccount(who, this.accountId, this.environment.CLOUDFLARE_ACCOUNT_ID);
    this.log(`Cloudflare account: ${this.accountId} (${who.authType || 'authenticated session'}).`);
  }
  async inspect(worker) {
    const result = await this.wr(['deployments', 'status', '--name', worker, '--json'], { allowFailure: true, config: this.pinplayFile });
    if (result.code !== 0) {
      ensure(worker === 'singing' && /\b10007\b/.test(result.stderr + result.stdout), `Could not inspect ${worker}. Authentication or network errors are not treated as a missing Worker.${this.diagnostic(result)}`);
      return null;
    }
    const deployment = parseJson(result.stdout, `${worker} deployment`), id = activeVersion(deployment);
    const version = parseJson((await this.wr(['versions', 'view', id, '--name', worker, '--json'], { config: this.pinplayFile })).stdout, `${worker} version`);
    const latest = latestVersion(parseJson((await this.wr(['versions', 'list', '--name', worker, '--json'], { config: this.pinplayFile })).stdout, `${worker} versions`));
    assertLatest(id, latest, this.state[worker]?.pending);
    return { id, deploymentId: deployment.id, createdAt: deployment.created_on, version, latest };
  }
  async privateBucket() {
    const dev = await this.wr(['r2', 'bucket', 'dev-url', 'get', 'singing-private-songs'], { config: this.pinplayFile });
    const domains = await this.wr(['r2', 'bucket', 'domain', 'list', 'singing-private-songs'], { config: this.pinplayFile });
    assertPrivateBucket(dev.stdout, domains.stdout);
  }
  async provision() {
    const listed = bucketNames((await this.wr(['r2', 'bucket', 'list'], { config: this.pinplayFile })).stdout);
    if (!listed.includes('singing-private-songs')) {
      this.log('Creating the private Singing R2 bucket…');
      await this.wr(['r2', 'bucket', 'create', 'singing-private-songs'], { config: this.pinplayFile });
    } else this.log('Reusing Singing’s private R2 bucket.');
    this.state.bucket = 'singing-private-songs'; await this.checkpoint();
    await this.privateBucket();
    const list = async () => parseJson((await this.wr(['d1', 'list', '--json'], { config: this.pinplayFile })).stdout, 'D1 databases');
    let databases = await list(); ensure(Array.isArray(databases), 'Unrecognized D1 database list.');
    if (!databases.some((db) => db.name === 'singing')) {
      this.log('Creating Singing’s D1 database…');
      await this.wr(['d1', 'create', 'singing', '--location', 'weur', '--update-config=false'], { config: this.pinplayFile });
      databases = await list();
    }
    const matches = databases.filter((db) => db.name === 'singing');
    ensure(matches.length === 1 && UUID.test(matches[0].uuid || '') && matches[0].uuid !== ZERO_UUID, 'Could not identify one Singing database.');
    const databaseId = matches[0].uuid;
    ensure(!this.state.databaseId || this.state.databaseId === databaseId, 'The Singing database UUID changed. Restore or review the recorded database before migrating.');
    if (UUID.test(this.base.d1_databases?.[0]?.database_id || '') && this.base.d1_databases[0].database_id !== ZERO_UUID) ensure(this.base.d1_databases[0].database_id === databaseId, 'Source config and discovered Singing database disagree.');
    this.state.databaseId = databaseId; await this.checkpoint();
    this.configFile = path.join(this.directory, 'singing.production.json');
    await writeFile(this.configFile, JSON.stringify(singingConfig(this.base, this.root, this.accountId, databaseId), null, 2) + '\n');
    const schema = parseJson((await this.wr(['d1', 'execute', 'DB', '--remote', '--command', "SELECT name FROM sqlite_master WHERE type = 'table'", '--json'])).stdout, 'Singing schema');
    const allowed = new Set(['d1_migrations']);
    for (const file of await readdir(path.join(this.root, 'cloudflare/migrations'))) if (file.endsWith('.sql')) {
      for (const match of (await readFile(path.join(this.root, 'cloudflare/migrations', file), 'utf8')).matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/gi)) allowed.add(match[1]);
    }
    ensure(Array.isArray(schema) && schema.every((result) => result.success && Array.isArray(result.results)), 'Could not inspect the Singing database schema.');
    ensure(schema.flatMap((result) => result.results).every((table) => allowed.has(table.name) || /^(sqlite_|_cf_)/.test(table.name)), 'The database contains tables outside Singing’s migrations. No migrations were applied.');
  }
  async saveRelease(pinplay, singing) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const release = { createdAt: new Date().toISOString(), accountId: this.accountId, databaseId: this.state.databaseId,
      pinplayBefore: { versionId: pinplay.id, deploymentId: pinplay.deploymentId },
      singingBefore: singing ? { versionId: singing.id, deploymentId: singing.deploymentId } : null,
      sourceCommit: this.state.source.commit, patchHash: this.state.source.patchHash };
    this.state.originalVersions ??= { pinplay: pinplay.id, singing: singing?.id || null };
    this.state.releaseFile = path.join(this.directory, 'releases', `${stamp}.json`);
    await mkdir(path.dirname(this.state.releaseFile), { recursive: true });
    await writeFile(this.state.releaseFile, JSON.stringify(release, null, 2) + '\n'); await this.checkpoint();
    return release;
  }
  async releaseExisting(worker, config, inspected, fingerprint) {
    const progress = this.state[worker] ||= {};
    const beforeUpload = await this.inspect(worker);
    ensure(beforeUpload.id === inspected.id, `${worker} changed during setup. Inspect the current release before uploading.`);
    if (worker === 'pinplay-api') assertPinplayBindings(beforeUpload.version, this.pinplay);
    else assertSingingBindings(beforeUpload.version, this.state.databaseId);
    if (progress.deployedFingerprint === fingerprint && progress.deployedVersion === inspected.id) {
      this.log(`${worker} already has this release; keeping its current version.`); return inspected.id;
    }
    let pending = progress.pending;
    if (!(pending?.fingerprint === fingerprint && (pending.baselineVersion === inspected.id || pending.versionId === inspected.id))) {
      this.log(`Uploading ${worker} code while preserving its variables and routes…`);
      const uploaded = await this.wr(['versions', 'upload', '--keep-vars', '--message', 'Singing classroom deployment'], { config, output: true });
      const record = deploymentRecord(uploaded.records, 'version-upload', worker);
      pending = progress.pending = { versionId: record.version_id, baselineVersion: inspected.id, fingerprint };
      await this.checkpoint();
    }
    const current = await this.inspect(worker);
    ensure(current.id === inspected.id || current.id === pending.versionId, `${worker} changed during deployment. The uploaded version was left staged; no concurrent release was replaced.`);
    if (current.id !== pending.versionId) {
      ensure(current.latest === pending.versionId, `${worker} has another staged version. Stop and review it before promotion.`);
      this.log(`Activating ${worker} version ${pending.versionId}…`);
      const promoted = await this.wr(['versions', 'deploy', `${pending.versionId}@100%`, '--yes', '--message', 'Singing classroom deployment'], { config, output: true });
      const record = deploymentRecord(promoted.records, 'version-deploy', worker);
      ensure(record.version_traffic?.[pending.versionId] === 100, `Cloudflare did not confirm 100% traffic for ${worker}.`);
    }
    progress.deployedVersion = pending.versionId; progress.deployedFingerprint = fingerprint; delete progress.pending;
    await this.checkpoint(); return progress.deployedVersion;
  }
  async deploy({ yes = false } = {}) {
    await this.prepare(); await this.authenticate();
    const pinplay = await this.inspect('pinplay-api'), singing = await this.inspect('singing');
    assertPinplayBindings(pinplay.version, this.pinplay);
    this.log(`Target: account ${this.accountId}; new/private Singing storage; PinPlay API identity adapter.`);
    this.log(`PinPlay source: ${this.state.source.commit}; current production version: ${pinplay.id}.`);
    if (!yes) ensure((await this.ask('Type DEPLOY to create/update these resources and release both apps: ')).trim() === 'DEPLOY', 'Deployment cancelled. Production is unchanged.');
    // Record the original versions before the first remote write, even if setup
    // fails partway through. Retries keep the original recovery baseline.
    await this.saveRelease(pinplay, singing);
    await this.provision();
    if (singing) assertSingingBindings(singing.version, this.state.databaseId);
    this.log('Applying only the Singing database migrations…');
    await this.wr(['d1', 'migrations', 'apply', 'DB', '--remote']);
    const sourceFingerprint = digest(JSON.stringify(this.state.source.hashes));
    await this.releaseExisting('pinplay-api', this.pinplayFile, pinplay, sourceFingerprint);
    const ready = await this.inspect('pinplay-api');
    ensure(ready.version.resources.script.named_handlers?.some((handler) => handler.name === 'ClassroomIdentity'), 'The deployed PinPlay version does not export ClassroomIdentity. Singing was not deployed.');
    const fingerprint = await this.siteFingerprint();
    if (singing) await this.releaseExisting('singing', this.configFile, singing, fingerprint);
    else {
      ensure(!await this.inspect('singing'), 'A Singing Worker appeared during setup. Rerun to inspect it before replacing it.');
      this.log('Deploying Singing and its static assets…');
      const deployed = await this.wr(['deploy', '--keep-vars', '--message', 'Initial Singing classroom deployment'], { output: true });
      const record = deploymentRecord(deployed.records, 'deploy', 'singing');
      const url = record.targets?.find((target) => typeof target === 'string' && /^https:\/\//.test(target));
      this.state.singing = { deployedVersion: record.version_id, deployedFingerprint: fingerprint };
      if (url) this.state.url = applicationUrl(url.replace(/\/$/, ''));
      await this.checkpoint();
    }
    await this.verify();
  }
  async siteFingerprint() {
    const hash = createHash('sha256');
    const visit = async (directory) => {
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(file); else { hash.update(path.relative(this.root, file)); hash.update(await readFile(file)); }
      }
    };
    await visit(path.join(this.root, '_site')); await visit(path.join(this.root, 'cloudflare'));
    hash.update(await readFile(this.configFile)); return hash.digest('hex');
  }
  async verify() {
    const candidate = this.environment.SINGING_DEPLOY_URL || this.state.url || await this.ask('Singing HTTPS address (from the Cloudflare dashboard): ');
    const url = applicationUrl(candidate); this.log(`Checking ${url}…`);
    const request = async (suffix) => {
      for (let attempt = 0; ; attempt++) {
        try { return await this.fetch(url + suffix, { redirect: 'error', signal: AbortSignal.timeout(15000) }); }
        catch (error) { if (attempt >= 2) throw error; await new Promise((resolve) => setTimeout(resolve, 1000)); }
      }
    };
    const [home, config, songs, source] = await Promise.all(['/', '/api/config', '/api/songs', '/cloudflare/worker.js'].map(request));
    ensure(home.status === 200 && home.headers.get('Content-Type')?.includes('text/html'), 'The Singing home page is unavailable.');
    ensure(config.status === 200, 'Shared sign-in is unavailable. Check the PinPlay ClassroomIdentity binding.');
    const data = await config.json(); ensure(data.cloud === true, 'This URL is not the cloud Singing app.');
    ensure(songs.status === 401 && songs.headers.get('Cache-Control')?.includes('no-store'), 'The private song library did not require authentication.');
    ensure(source.status === 404, 'Server source is unexpectedly available through the static host.');
    this.state.url = url; this.state.verifiedAt = new Date().toISOString(); await this.checkpoint();
    const notes = [
      `Singing: ${url}`, '', 'Public smoke checks passed; private uploads and real Google sign-in still need a teacher/student browser check.', '',
      `Google OAuth authorized JavaScript origin: ${url}`,
      'Add that origin to the existing Google client at https://console.cloud.google.com/apis/credentials .',
      data.googleClientId ? `Public Google client ID: ${data.googleClientId}` : 'PinPlay has no Google client ID configured; configure its existing Google login before student sign-in.', '',
      'For old local songs: publish the updated static app at its old address first. Keep the old address available.',
      'At the OLD address: Sign in button -> Export local backup with audio (cloud login is not required for export).',
      'At the NEW address: teacher sign-in -> confirm permission -> Import backup to cloud.', '',
      `Original PinPlay recovery version: ${this.state.originalVersions?.pinplay || 'Not recorded by this checkout'}`,
      `Release records: ${path.join(this.directory, 'releases')}`,
      'Worker rollback does not undo database migrations or delete R2 objects. See docs/CLOUD_DEPLOYMENT.md.',
    ].join('\n') + '\n';
    await writeFile(path.join(this.directory, 'NEXT-STEPS.txt'), notes);
    this.log(`Public smoke checks passed.\nApp: ${url}\nGoogle OAuth origin: ${url}\nRemaining browser steps: .deployment/NEXT-STEPS.txt`);
    return url;
  }
}
