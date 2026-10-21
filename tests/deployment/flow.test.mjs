import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Deployment } from '../../tools/deployment.mjs';
import { createHash } from 'node:crypto';

// Every command and HTTP request is an in-memory fixture. This file never starts
// Wrangler, Git, a shell, or any other child process and never accesses a network.
const repository = fileURLToPath(new URL('../../', import.meta.url));
const accountId = 'abcdef0123456789abcdef0123456789';
const baseline = '11111111-1111-4111-8111-111111111111';
const databaseId = '33333333-3333-4333-8333-333333333333';
const otherDatabase = '44444444-4444-4444-8444-444444444444';
const appUrl = 'https://singing.fixture.workers.dev';
const uuid = (n) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

function pinplayConfig() {
  return {
    name: 'pinplay-api', account_id: accountId, main: 'classroom-entry.mjs', compatibility_date: '2026-03-04',
    migrations: [{ tag: 'v1', new_sqlite_classes: ['QuizRoom'] }],
    r2_buckets: [{ binding: 'QUIZ_MEDIA', bucket_name: 'pinplay-quiz-media' }],
    durable_objects: { bindings: [{ name: 'ROOMS', class_name: 'QuizRoom' }] },
    unsafe: { bindings: [{ name: 'AUTH_RL', type: 'ratelimit', namespace_id: '1001', simple: { limit: 50, period: 60 } }] },
  };
}

function pinplayVersion(id = baseline, number = 1, adapter = false) {
  return { id, number, resources: {
    script_runtime: { migration_tag: 'v1', compatibility_date: '2026-03-04' },
    script: { named_handlers: adapter ? [{ name: 'ClassroomIdentity' }] : [] },
    bindings: [
      { name: 'QUIZ_MEDIA', type: 'r2_bucket', bucket_name: 'pinplay-quiz-media' },
      { name: 'ROOMS', type: 'durable_object_namespace', class_name: 'QuizRoom' },
      { name: 'AUTH_RL', type: 'ratelimit', namespace_id: '1001', simple: { limit: 50, period: 60 } },
      { name: 'CREATE_PASSWORD_HASH', type: 'secret_text' },
      { name: 'STUDENT_SESSION_KEY', type: 'secret_text' },
      { name: 'GOOGLE_CLIENT_ID', type: 'plain_text', text: 'fixture-public-client' },
    ],
  } };
}

function singingVersion(id, number, db = databaseId) {
  return { id, number, resources: { script: { named_handlers: [] }, bindings: [
    { name: 'DB', type: 'd1', id: db },
    { name: 'SONGS', type: 'r2_bucket', bucket_name: 'singing-private-songs' },
    { name: 'IDENTITY', type: 'service', service: 'pinplay-api', entrypoint: 'ClassroomIdentity' },
    { name: 'AUTH_RL', type: 'ratelimit', namespace_id: '1002' },
    { name: 'ASSETS', type: 'assets' },
  ] } };
}

async function fixture(t, setup = () => {}) {
  const temporaryRoot = path.resolve(tmpdir());
  const root = await mkdtemp(path.join(temporaryRoot, 'singing-deploy-flow-'));
  t.after(async () => {
    const relative = path.relative(temporaryRoot, path.resolve(root));
    assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    assert(path.basename(root).startsWith('singing-deploy-flow-'));
    await rm(root, { recursive: true, force: true });
  });
  await cp(path.join(repository, 'wrangler.jsonc'), path.join(root, 'wrangler.jsonc'));
  await mkdir(path.join(root, 'cloudflare'), { recursive: true });
  await cp(path.join(repository, 'cloudflare/migrations'), path.join(root, 'cloudflare/migrations'), { recursive: true });
  await mkdir(path.join(root, 'integrations'), { recursive: true });
  await writeFile(path.join(root, 'integrations/pinplay-classroom.patch'), 'fixture identity patch');
  const patchHash = createHash('sha256').update('fixture identity patch').digest('hex');
  const world = {
    bucket: false, database: false, migrated: false, tables: [], publicBucket: false, customDomain: false,
    migrationFailures: 0, promotionFailures: 0, statusFailures: {}, sequence: 10,
    workers: { 'pinplay-api': { active: baseline, versions: [pinplayVersion()] } },
    calls: [], writes: [], fetches: [], builds: 0, fingerprint: 'identical-site-and-worker-fixture',
  };
  setup(world);
  const success = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  const failure = (message) => ({ code: 1, stdout: '', stderr: `[ERROR] ${message}` });
  const json = (value) => success(JSON.stringify(value));
  const argument = (args, name) => args[args.indexOf(name) + 1];
  const recordWrite = async (kind, worker) => {
    // Recovery information must exist before even the first remote write.
    const state = JSON.parse(await readFile(path.join(root, '.deployment/state.json'), 'utf8'));
    assert.equal(state.originalVersions.pinplay, baseline);
    const release = JSON.parse(await readFile(state.releaseFile, 'utf8'));
    assert.equal(release.accountId, accountId);
    world.writes.push({ kind, worker });
  };
  const run = async (command, argv, options) => {
    assert.equal(command, process.execPath, 'all subprocess calls in this harness must target the pinned Node CLI');
    assert.equal(argv[0], path.join(root, 'node_modules/wrangler/bin/wrangler.js'));
    assert.equal(options.env.CLOUDFLARE_ACCOUNT_ID, accountId);
    assert.equal(options.env.NO_COLOR, '1');
    assert.equal(options.env.WRANGLER_SEND_METRICS, 'false');
    const configIndex = argv.indexOf('--config');
    assert(configIndex > 0, 'every operation must use an explicit generated config');
    const configFile = argv[configIndex + 1];
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    assert.equal(config.account_id, accountId);
    const args = argv.slice(1, configIndex);
    const worker = args.includes('--name') ? argument(args, '--name') : config.name;
    world.calls.push({ args, worker, configFile });
    const output = async (row) => {
      const filename = options.env.WRANGLER_OUTPUT_FILE_PATH;
      assert(filename && path.dirname(filename) === path.join(root, '.deployment'));
      await writeFile(filename, JSON.stringify(row) + '\n'); return success();
    };
    if (args[0] === 'whoami') return json({ loggedIn: true, accounts: [{ id: accountId }], authType: 'fixture' });
    if (args[0] === 'deployments' && args[1] === 'status') {
      const injected = world.statusFailures[worker];
      if (injected) return failure(injected);
      const current = world.workers[worker];
      if (!current) return failure('Worker does not exist [code: 10007]');
      return json({ id: uuid(100), created_on: '2026-10-21T10:00:00Z', versions: current.traffic || [{ version_id: current.active, percentage: 100 }] });
    }
    if (args[0] === 'versions' && args[1] === 'view') {
      const version = world.workers[worker]?.versions.find((value) => value.id === args[2]);
      assert(version, 'inspection must request an existing version'); return json(version);
    }
    if (args[0] === 'versions' && args[1] === 'list') return json({ items: world.workers[worker].versions });
    if (args[0] === 'r2' && args[1] === 'bucket') {
      if (args[2] === 'list') return success(`name: pinplay-quiz-media\n${world.bucket ? 'name: singing-private-songs\n' : ''}`);
      if (args[2] === 'create') {
        assert.equal(args[3], 'singing-private-songs'); assert(!world.bucket);
        await recordWrite('bucket'); world.bucket = true; return success();
      }
      if (args[2] === 'dev-url' && args[3] === 'get') return success(world.publicBucket ? 'Public access is enabled.' : 'Public access via the r2.dev URL is disabled.');
      if (args[2] === 'domain' && args[3] === 'list') return success(world.customDomain ? 'music.fixture.example is connected.' : 'There are no custom domains connected to this bucket.');
    }
    if (args[0] === 'd1') {
      if (args[1] === 'list') return json(world.database ? [{ uuid: databaseId, name: 'singing' }] : []);
      if (args[1] === 'create') {
        assert.equal(args[2], 'singing'); assert(args.includes('--update-config=false')); assert(!world.database);
        await recordWrite('database'); world.database = true; return success();
      }
      assert.equal(config.d1_databases[0].database_id, databaseId);
      assert.equal(config.d1_databases[0].database_name, 'singing');
      assert(args.includes('--remote'));
      if (args[1] === 'execute') {
        assert.equal(args[2], 'DB');
        if (argument(args, '--command') === 'SELECT name FROM d1_migrations ORDER BY name') {
          return json([{ success: true, results: (world.migrationNames || ['0001_cloud_library.sql', '0002_assignments.sql']).map((name) => ({ name })) }]);
        }
        assert.equal(argument(args, '--command'), "SELECT name FROM sqlite_master WHERE type = 'table'");
        return json([{ success: true, results: world.tables.map((name) => ({ name })) }]);
      }
      if (args[1] === 'migrations' && args[2] === 'apply') {
        assert.equal(args[3], 'DB'); await recordWrite('migration');
        if (world.migrationFailures > 0) { world.migrationFailures--; return failure('Fixture migration failed'); }
        world.migrated = true; world.tables = ['d1_migrations', 'sessions', 'songs', 'assignments'];
        world.afterMigration?.(); return success();
      }
    }
    if (args[0] === 'versions' && args[1] === 'upload') {
      assert(world.migrated, 'no Worker code may upload before migrations succeed');
      assert(args.includes('--keep-vars'), 'existing dashboard variables must survive upload');
      await recordWrite('upload', worker);
      const number = world.sequence++, id = uuid(number);
      world.workers[worker].versions.push(worker === 'pinplay-api' ? pinplayVersion(id, number, true) : singingVersion(id, number));
      if (worker === 'singing') world.afterSingingUpload?.();
      return output({ type: 'version-upload', worker_name: worker, version_id: id });
    }
    if (args[0] === 'versions' && args[1] === 'deploy') {
      assert(args.includes('--yes')); assert(args[2].endsWith('@100%'));
      const id = args[2].split('@')[0];
      assert(world.workers[worker].versions.some((version) => version.id === id));
      await recordWrite('promotion', worker);
      if (world.promotionFailures > 0) { world.promotionFailures--; return failure('Fixture promotion failed'); }
      world.workers[worker].active = id;
      world.afterPromotion?.(worker, id);
      // Real Wrangler 4.151.3 receipt: its Map becomes an empty JSON object.
      return output({ type: 'version-deploy', worker_name: worker, deployment_id: uuid(200), version_traffic: world.promotionTraffic || {} });
    }
    if (args[0] === 'deploy') {
      assert.equal(worker, 'singing'); assert(!world.workers.singing); assert(world.migrated);
      const activePinplay = world.workers['pinplay-api'].versions.find((version) => version.id === world.workers['pinplay-api'].active);
      assert(activePinplay.resources.script.named_handlers.some((handler) => handler.name === 'ClassroomIdentity'));
      await recordWrite('initial-deploy', worker);
      const number = world.sequence++, id = uuid(number);
      world.workers.singing = { active: id, versions: [singingVersion(id, number)] };
      return output({ type: 'deploy', worker_name: 'singing', version_id: id, targets: [appUrl] });
    }
    assert.fail(`Unexpected fixture command: ${args.join(' ')}`);
  };
  const fetch = async (value, options) => {
    const url = new URL(value); assert.equal(url.origin, appUrl); assert.equal(options.redirect, 'error');
    world.fetches.push(url.pathname);
    if (url.pathname === '/') return new Response('<!doctype html><title>Singing fixture</title>', { headers: { 'Content-Type': 'text/html' } });
    if (url.pathname === '/api/config') return Response.json({ cloud: true, googleClientId: 'fixture-public-client' });
    if (url.pathname === '/api/songs') return Response.json({ error: 'Sign in' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
    if (url.pathname === '/cloudflare/worker.js') return new Response('Not found', { status: 404 });
    assert.fail(`Unexpected fixture request: ${url}`);
  };
  const load = async (answer = 'DEPLOY') => {
    const deployment = await new Deployment({ root, run, fetch, environment: {}, log: () => {}, ask: async () => answer,
      readConfig: async (filename) => JSON.parse(await readFile(filename, 'utf8')) }).load();
    deployment.prepare = async function () {
      this.accountId = accountId; this.pinplay = pinplayConfig(); this.state.accountId = accountId;
      this.pinplayFile = path.join(this.directory, 'pinplay.production.json');
      await writeFile(this.pinplayFile, JSON.stringify(this.pinplay));
      this.state.source = { commit: 'a'.repeat(40), patchHash, hashes: { 'cloudflare/worker.js': 'fixture-source-hash' } };
      await this.checkpoint();
    };
    deployment.siteFingerprint = async () => world.fingerprint;
    deployment.node = async (args) => { assert.deepEqual(args, ['tools/build-site.mjs']); world.builds++; };
    return deployment;
  };
  return { root, world, load, count: (kind) => world.writes.filter((write) => write.kind === kind).length };
}

test('fresh deployment creates only Singing storage, migrates before code, and verifies anonymous access', async (t) => {
  const { root, world, load } = await fixture(t);
  const deployment = await load(); await deployment.deploy();
  assert.deepEqual(world.writes.map((write) => [write.kind, write.worker]), [
    ['bucket', undefined], ['database', undefined], ['migration', undefined],
    ['upload', 'pinplay-api'], ['promotion', 'pinplay-api'], ['initial-deploy', 'singing'],
  ]);
  assert.equal(deployment.state.databaseId, databaseId);
  assert.equal(deployment.state.originalVersions.pinplay, baseline);
  assert.equal(deployment.state.url, appUrl);
  assert.deepEqual(world.fetches.sort(), ['/', '/api/config', '/api/songs', '/cloudflare/worker.js'].sort());
  const config = JSON.parse(await readFile(path.join(root, '.deployment/singing.production.json'), 'utf8'));
  assert.equal(config.d1_databases[0].database_id, databaseId);
  assert.equal(config.r2_buckets[0].bucket_name, 'singing-private-songs');
  const notes = await readFile(path.join(root, '.deployment/NEXT-STEPS.txt'), 'utf8');
  assert.match(notes, /authorized JavaScript origin/); assert.match(notes, /OLD address/);
  assert(!world.calls.some(({ args }) => args.includes('delete') || args.includes('--secrets-file')));
});

test('an identical retry preserves all resource IDs and does not upload or promote code again', async (t) => {
  const { world, load, count } = await fixture(t);
  await (await load()).deploy({ yes: true });
  const pinplay = world.workers['pinplay-api'].active, singing = world.workers.singing.active;
  const retry = await load(); await retry.deploy({ yes: true });
  assert.equal(count('bucket'), 1); assert.equal(count('database'), 1);
  assert.equal(count('upload'), 1); assert.equal(count('promotion'), 1); assert.equal(count('initial-deploy'), 1);
  assert.equal(world.workers['pinplay-api'].active, pinplay); assert.equal(world.workers.singing.active, singing);
  assert.equal(retry.state.originalVersions.pinplay, baseline); assert.equal(retry.state.databaseId, databaseId);
});

test('a failed migration stops code deployment and retries reuse resources and original recovery version', async (t) => {
  const { world, load, count } = await fixture(t, (state) => { state.migrationFailures = 1; });
  const first = await load(); await assert.rejects(first.deploy({ yes: true }), /migration failed|migrations apply/);
  assert.equal(count('upload'), 0); assert.equal(count('initial-deploy'), 0); assert(!world.workers.singing);
  assert.equal(first.state.databaseId, databaseId); assert.equal(first.state.originalVersions.pinplay, baseline);
  const retry = await load(); await retry.deploy({ yes: true });
  assert.equal(count('bucket'), 1); assert.equal(count('database'), 1); assert.equal(count('migration'), 2);
  assert.equal(count('upload'), 1); assert.equal(retry.state.originalVersions.pinplay, baseline);
});

test('a failed promotion resumes the exact saved staged version without uploading another one', async (t) => {
  const { world, load, count } = await fixture(t, (state) => { state.promotionFailures = 1; });
  const first = await load(); await assert.rejects(first.deploy({ yes: true }), /promotion failed|versions deploy/);
  const pending = first.state['pinplay-api'].pending;
  assert(pending?.versionId); assert.equal(pending.baselineVersion, baseline);
  assert.equal(world.workers['pinplay-api'].active, baseline); assert(!world.workers.singing);
  const retry = await load(); await retry.deploy({ yes: true });
  assert.equal(count('upload'), 1); assert.equal(count('promotion'), 2);
  assert.equal(world.workers['pinplay-api'].active, pending.versionId);
  assert.equal(retry.state['pinplay-api'].pending, undefined); assert.equal(retry.state.originalVersions.pinplay, baseline);
});

test('an unexpected PinPlay binding stops before any production write', async (t) => {
  const { load, world } = await fixture(t, (state) => {
    state.workers['pinplay-api'].versions[0].resources.bindings.push({ name: 'UNRELATED_DATA', type: 'kv_namespace' });
  });
  await assert.rejects((await load()).deploy({ yes: true }), /UNRELATED_DATA/);
  assert.deepEqual(world.writes, []);
});

test('a concurrent PinPlay release during Singing setup is preserved without uploading over it', async (t) => {
  const { load, world, count } = await fixture(t, (state) => {
    state.afterMigration = () => {
      const version = pinplayVersion(uuid(99), 99);
      state.workers['pinplay-api'].versions.push(version);
      state.workers['pinplay-api'].active = version.id;
    };
  });
  await assert.rejects((await load()).deploy({ yes: true }), /changed during setup/);
  assert.equal(world.workers['pinplay-api'].active, uuid(99));
  assert.equal(count('upload'), 0); assert.equal(count('promotion'), 0); assert.equal(count('initial-deploy'), 0);
});

test('an unrelated staged version stops before resource creation or code upload', async (t) => {
  const { load, world } = await fixture(t, (state) => { state.workers['pinplay-api'].versions.push(pinplayVersion(uuid(99), 99)); });
  await assert.rejects((await load()).deploy({ yes: true }), /unrecognized staged/);
  assert.deepEqual(world.writes, []);
});

test('network and authentication inspection errors are never treated as a missing Singing Worker', async (t) => {
  for (const error of ['Network request failed', 'Authentication failed [code: 10000]']) {
    await t.test(error, async (subtest) => {
      const { load, world } = await fixture(subtest, (state) => { state.statusFailures.singing = error; });
      await assert.rejects((await load()).deploy({ yes: true }), /Could not inspect singing/);
      assert.deepEqual(world.writes, []);
    });
  }
});

test('existing public R2 endpoints stop before database migration or code replacement', async (t) => {
  for (const property of ['publicBucket', 'customDomain']) {
    await t.test(property, async (subtest) => {
      const { load, world } = await fixture(subtest, (state) => { state.bucket = true; state[property] = true; });
      await assert.rejects((await load()).deploy({ yes: true }), /public|custom domains/);
      assert.deepEqual(world.writes, []); assert.equal(world.database, false);
    });
  }
});

test('existing tables from another application stop before migrations and code uploads', async (t) => {
  const { load, world } = await fixture(t, (state) => {
    state.bucket = true; state.database = true; state.tables = ['pinplay_assignments'];
  });
  await assert.rejects((await load()).deploy({ yes: true }), /tables outside Singing/);
  assert.deepEqual(world.writes, []);
});

test('a live Singing Worker using a different database cannot be silently rebound', async (t) => {
  const { load, world } = await fixture(t, (state) => {
    state.bucket = true; state.database = true;
    const version = singingVersion(uuid(8), 8, otherDatabase);
    state.workers.singing = { active: version.id, versions: [version] };
  });
  await assert.rejects((await load()).deploy({ yes: true }), /another D1 database/);
  assert.deepEqual(world.writes, []);
});

test('cancelling the final deployment prompt leaves production unchanged', async (t) => {
  const { load, world } = await fixture(t);
  await assert.rejects((await load('CANCEL')).deploy(), /Deployment cancelled/);
  assert.deepEqual(world.writes, []); assert.equal(world.bucket, false); assert.equal(world.database, false);
});

test('fast update publishes only Singing and skips PinPlay, provisioning, tests and migration writes', async (t) => {
  const { world, load } = await fixture(t);
  await (await load()).deploy({ yes: true });
  const originalPinplay = world.workers['pinplay-api'].active;
  world.writes = []; world.calls = []; world.fingerprint = 'new-singing-code';
  const update = await load();
  update.prepare = () => assert.fail('fast update cannot prepare PinPlay or run the full suites');
  await update.update({ yes: true });
  assert.equal(world.builds, 1);
  assert.deepEqual(world.writes.map((w) => [w.kind, w.worker]), [['upload', 'singing'], ['promotion', 'singing']]);
  assert.equal(world.workers['pinplay-api'].active, originalPinplay);
  assert(world.calls.every((call) => call.worker === 'singing'));
  assert(!world.calls.some(({ args }) => ['d1', 'r2'].includes(args[0])));
  const release = JSON.parse(await readFile(update.state.releaseFile, 'utf8'));
  assert.equal(release.kind, 'singing-update'); assert.equal(release.pinplayBefore, null);
  assert.equal(update.state.singing.deployedVersion, world.workers.singing.active);
});

test('fast update requires completed setup and skips uploading identical code', async (t) => {
  const { world, load } = await fixture(t);
  await assert.rejects((await load()).update({ yes: true }), /existing Singing deployment/);
  assert.equal(world.builds, 0); assert.equal(world.writes.length, 0);
  await (await load()).deploy({ yes: true });
  world.writes = []; world.calls = [];
  await (await load()).update({ yes: true });
  assert.deepEqual(world.writes, []);
  assert(world.calls.every((call) => call.worker === 'singing'));
});

test('fast update refuses changed migrations, config and shared identity before any remote writes', async (t) => {
  for (const change of ['migration', 'config', 'identity']) {
    await t.test(change, async (subtest) => {
      const { root, world, load } = await fixture(subtest);
      await (await load()).deploy({ yes: true }); world.writes = []; world.calls = [];
      const update = await load();
      if (change === 'migration') await writeFile(path.join(root, 'cloudflare/migrations/0003_new.sql'), 'CREATE TABLE extra (id TEXT);');
      if (change === 'config') update.base.compatibility_date = '2026-10-22';
      if (change === 'identity') await writeFile(path.join(root, 'integrations/pinplay-classroom.patch'), 'changed identity integration');
      await assert.rejects(update.update({ yes: true }), /Full setup/);
      assert.equal(world.builds, 0); assert.deepEqual(world.writes, []); assert.deepEqual(world.calls, []);
    });
  }
});

test('older setup records need only one read-only migration check before fast updates', async (t) => {
  const { world, load } = await fixture(t);
  const setup = await load(); await setup.deploy({ yes: true });
  delete setup.state.schemaFingerprint; delete setup.state.identityPatchHash; delete setup.state.singingConfigFingerprint;
  await setup.checkpoint(); world.writes = []; world.calls = []; world.fingerprint = 'new-site';
  await (await load()).update({ yes: true });
  const d1 = world.calls.filter(({ args }) => args[0] === 'd1');
  assert.equal(d1.length, 1); assert.equal(d1[0].args[1], 'execute');
  assert(world.writes.every((write) => write.worker === 'singing'));
  world.calls = [];
  await (await load()).update({ yes: true });
  assert(!world.calls.some(({ args }) => args[0] === 'd1'));
});

test('older setup records with unapplied migrations refuse fast upload', async (t) => {
  const { world, load } = await fixture(t);
  const setup = await load(); await setup.deploy({ yes: true });
  delete setup.state.schemaFingerprint; await setup.checkpoint();
  world.migrationNames = ['0001_cloud_library.sql']; world.writes = []; world.fingerprint = 'new-site';
  await assert.rejects((await load()).update({ yes: true }), /Unapplied or missing/);
  assert.deepEqual(world.writes, []);
});

test('fast update resumes an interrupted promotion without uploading the same code again', async (t) => {
  const { world, load } = await fixture(t);
  await (await load()).deploy({ yes: true });
  world.writes = []; world.fingerprint = 'new-site'; world.promotionFailures = 1;
  await assert.rejects((await load()).update({ yes: true }), /promotion failed/);
  await (await load()).update({ yes: true });
  assert.equal(world.writes.filter((w) => w.kind === 'upload').length, 1);
  assert.equal(world.writes.filter((w) => w.kind === 'promotion').length, 2);
  assert(world.writes.every((w) => w.worker === 'singing'));
});

test('fast update checks actual traffic even when the promotion receipt claims success', async (t) => {
  for (const outcome of ['previous version', 'partial traffic', 'different version', 'missing traffic']) {
    await t.test(outcome, async (subtest) => {
      const { world, load } = await fixture(subtest);
      const setup = await load(); await setup.deploy({ yes: true });
      const before = world.workers.singing.active;
      world.writes = []; world.fetches = []; world.fingerprint = 'new-site';
      world.afterPromotion = (worker, id) => {
        assert.equal(worker, 'singing');
        world.promotionTraffic = { [id]: 100 };
        if (outcome === 'previous version') world.workers.singing.active = before;
        if (outcome === 'partial traffic') world.workers.singing.traffic = [
          { version_id: id, percentage: 50 }, { version_id: before, percentage: 50 },
        ];
        if (outcome === 'different version') {
          world.workers.singing.versions.push(singingVersion(uuid(99), 99));
          world.workers.singing.active = uuid(99);
        }
        if (outcome === 'missing traffic') world.workers.singing.traffic = [];
      };
      const update = await load();
      await assert.rejects(update.update({ yes: true }), /did not confirm 100% traffic|one production version/);
      const saved = JSON.parse(await readFile(path.join(update.directory, 'state.json'), 'utf8'));
      assert.equal(saved.singing.deployedVersion, before);
      assert(saved.singing.pending?.versionId);
      assert.deepEqual(world.fetches, [], 'no success smoke checks before deployment confirmation');
      assert.deepEqual(world.writes.map((w) => w.kind), ['upload', 'promotion']);
    });
  }
});

test('fast update recovers an already live version after a failed confirmation without prompting or publishing again', async (t) => {
  const { world, load } = await fixture(t);
  await (await load()).deploy({ yes: true });
  world.writes = []; world.fingerprint = 'new-site';
  world.afterPromotion = (worker) => { world.statusFailures[worker] = 'Fixture confirmation unavailable'; };
  const first = await load();
  await assert.rejects(first.update({ yes: true }), /deployments status.*failed/);
  const pending = first.state.singing.pending;
  assert.equal(world.workers.singing.active, pending.versionId);
  const releaseFile = first.state.releaseFile;
  delete world.statusFailures.singing;
  world.calls = [];
  const retry = await load();
  retry.ask = async () => assert.fail('already live recovery needs no deployment confirmation');
  await retry.update();
  assert.equal(retry.state.singing.deployedVersion, pending.versionId);
  assert.equal(retry.state.singing.deployedFingerprint, pending.fingerprint);
  assert.equal(retry.state.singing.pending, undefined);
  assert.equal(retry.state.releaseFile, releaseFile);
  assert.deepEqual(world.writes.map((w) => w.kind), ['upload', 'promotion']);
  assert(world.calls.every((call) => call.worker === 'singing'));
  assert(!world.calls.some(({ args }) => ['d1', 'r2'].includes(args[0])));
});

test('an already live pending version does not skip confirmation when source files have changed', async (t) => {
  const { world, load } = await fixture(t);
  await (await load()).deploy({ yes: true });
  world.fingerprint = 'new-site';
  world.afterPromotion = (worker) => { world.statusFailures[worker] = 'Fixture confirmation unavailable'; };
  await assert.rejects((await load()).update({ yes: true }), /deployments status.*failed/);
  delete world.statusFailures.singing;
  world.fingerprint = 'changed-again'; world.writes = [];
  await assert.rejects((await load('CANCEL')).update(), /cancelled/);
  assert.deepEqual(world.writes, []);
});

test('fast update preserves a concurrent Singing release and leaves its upload staged', async (t) => {
  const { world, load } = await fixture(t);
  await (await load()).deploy({ yes: true });
  world.writes = []; world.fingerprint = 'new-site';
  world.afterSingingUpload = () => {
    const concurrent = singingVersion(uuid(99), 99);
    world.workers.singing.versions.push(concurrent); world.workers.singing.active = concurrent.id;
  };
  await assert.rejects((await load()).update({ yes: true }), /changed during deployment/);
  assert.equal(world.workers.singing.active, uuid(99));
  assert.deepEqual(world.writes.map((w) => w.kind), ['upload']);
});

test('fast update rejects incorrect live bindings and cancellation without replacing code', async (t) => {
  const { world, load } = await fixture(t);
  await (await load()).deploy({ yes: true });
  world.writes = []; world.fingerprint = 'new-site';
  await assert.rejects((await load('CANCEL')).update(), /cancelled/);
  assert.deepEqual(world.writes, []);
  world.workers.singing.versions.find((v) => v.id === world.workers.singing.active).resources.bindings.find((b) => b.name === 'DB').id = otherDatabase;
  await assert.rejects((await load()).update({ yes: true }), /another D1 database/);
  assert.deepEqual(world.writes, []);
});

test('fast update refuses unknown staged code before uploading', async (t) => {
  const { world, load } = await fixture(t);
  await (await load()).deploy({ yes: true });
  world.writes = []; world.fingerprint = 'new-site';
  world.workers.singing.versions.push(singingVersion(uuid(99), 99));
  await assert.rejects((await load()).update({ yes: true }), /unrecognized staged/);
  assert.deepEqual(world.writes, []);
});

test('fast update rechecks releases after the confirmation prompt', async (t) => {
  const { world, load } = await fixture(t);
  await (await load()).deploy({ yes: true });
  world.writes = []; world.fingerprint = 'new-site';
  const update = await load();
  update.ask = async () => {
    const concurrent = singingVersion(uuid(99), 99);
    world.workers.singing.versions.push(concurrent); world.workers.singing.active = concurrent.id;
    return 'DEPLOY';
  };
  await assert.rejects(update.update(), /changed while confirming/);
  assert.deepEqual(world.writes, []); assert.equal(world.workers.singing.active, uuid(99));
});
