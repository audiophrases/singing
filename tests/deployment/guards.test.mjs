import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  ZERO_UUID, parseJson, scopedPath, requireAccount, activeVersion, latestVersion,
  assertLatest, bucketNames, assertPrivateBucket, deploymentRecord, applicationUrl,
  singingConfig, pinplayConfig, assertPinplayBindings, assertSingingBindings,
} from '../../tools/deployment.mjs';

const accountId = 'abcdef0123456789abcdef0123456789';
const versionA = '11111111-1111-4111-8111-111111111111';
const versionB = '22222222-2222-4222-8222-222222222222';
const databaseId = '33333333-3333-4333-8333-333333333333';
const deploymentId = '44444444-4444-4444-8444-444444444444';

function localPinplay() {
  return {
    name: 'pinplay-api', account_id: accountId, main: 'classroom-entry.mjs',
    compatibility_date: '2026-03-04',
    migrations: [{ tag: 'v1', new_sqlite_classes: ['QuizRoom'] }],
    r2_buckets: [{ binding: 'QUIZ_MEDIA', bucket_name: 'pinplay-quiz-media' }],
    durable_objects: { bindings: [{ name: 'ROOMS', class_name: 'QuizRoom' }] },
    unsafe: { bindings: [{ name: 'AUTH_RL', type: 'ratelimit', namespace_id: '1001', simple: { limit: 50, period: 60 } }] },
  };
}

function livePinplay() {
  return { resources: {
    script_runtime: { migration_tag: 'v1', compatibility_date: '2026-03-04' },
    bindings: [
      { name: 'QUIZ_MEDIA', type: 'r2_bucket', bucket_name: 'pinplay-quiz-media' },
      { name: 'ROOMS', type: 'durable_object_namespace', class_name: 'QuizRoom', namespace_id: 'existing-durable-namespace' },
      { name: 'AUTH_RL', type: 'ratelimit', namespace_id: 1001, simple: { limit: 50, period: 60 } },
      { name: 'CREATE_PASSWORD_HASH', type: 'secret_text' },
      { name: 'STUDENT_SESSION_KEY', type: 'secret_text' },
      { name: 'GOOGLE_CLIENT_ID', type: 'plain_text', text: 'public-client-id' },
    ],
  } };
}

function localSinging() {
  return {
    $schema: 'node_modules/wrangler/config-schema.json', name: 'singing',
    main: 'cloudflare/worker.js', assets: { directory: './_site', binding: 'ASSETS' },
    d1_databases: [{ binding: 'DB', database_name: 'singing', database_id: ZERO_UUID, migrations_dir: 'cloudflare/migrations' }],
    r2_buckets: [{ binding: 'SONGS', bucket_name: 'singing-private-songs' }],
    services: [{ binding: 'IDENTITY', service: 'pinplay-api', entrypoint: 'ClassroomIdentity' }],
  };
}

function liveSinging() {
  return { resources: { bindings: [
    { name: 'DB', type: 'd1', id: databaseId },
    { name: 'SONGS', type: 'r2_bucket', bucket_name: 'singing-private-songs' },
    { name: 'IDENTITY', type: 'service', service: 'pinplay-api', entrypoint: 'ClassroomIdentity' },
    { name: 'ASSETS', type: 'assets' },
    { name: 'AUTH_RL', type: 'ratelimit', namespace_id: '1002' },
    { name: 'OWNER_STORAGE_BYTES', type: 'plain_text', text: '1073741824' },
  ] } };
}

test('JSON command parsing accepts color escapes and refuses prose or truncated responses', () => {
  assert.deepEqual(parseJson('\u001b[32m{"loggedIn":true}\u001b[0m\n', 'identity'), { loggedIn: true });
  assert.throws(() => parseJson('Warning: connection failed\n{}', 'identity'), /identity did not return valid JSON/);
  assert.throws(() => parseJson('{"accounts":', 'identity'), /valid JSON/);
});

test('generated paths remain within the workspace, including names with spaces and shell punctuation', () => {
  const root = path.resolve('deployment fixture & review');
  assert.equal(scopedPath(root, '.deployment', 'source checkout'), path.join(root, '.deployment', 'source checkout'));
  assert.throws(() => scopedPath(root), /stay inside/);
  assert.throws(() => scopedPath(root, '..', 'outside'), /stay inside/);
  assert.throws(() => scopedPath(root, path.resolve(root, '..', 'sibling')), /stay inside/);
  assert.equal(scopedPath(root, '..still-inside', 'file'), path.join(root, '..still-inside', 'file'));
});

test('account guard requires explicit membership and refuses a different ambient account', () => {
  const who = { loggedIn: true, accounts: [{ id: '99999999999999999999999999999999' }, { id: accountId }] };
  assert.equal(requireAccount(who, accountId), accountId);
  assert.equal(requireAccount(who, accountId, accountId), accountId);
  assert.throws(() => requireAccount(who, accountId, '99999999999999999999999999999999'), /another account/);
  assert.throws(() => requireAccount({ loggedIn: false, accounts: who.accounts }, accountId), /cannot access/);
  assert.throws(() => requireAccount({ loggedIn: true, accounts: [] }, accountId), /cannot access/);
  assert.throws(() => requireAccount(who, ''), /account_id explicitly/);
});

test('production version guard refuses gradual rollouts and missing or malformed deployment records', () => {
  assert.equal(activeVersion({ versions: [{ version_id: versionA, percentage: 100 }] }), versionA);
  for (const value of [undefined, {}, { versions: [] },
    { versions: [{ version_id: versionA, percentage: 50 }, { version_id: versionB, percentage: 50 }] },
    { versions: [{ version_id: versionA, percentage: 0 }] },
    { versions: [{ version_id: 'not-a-version', percentage: 100 }] },
  ]) assert.throws(() => activeVersion(value), /one production version/);
});

test('latest version guard identifies newest numbered release without relying on API order', () => {
  const versions = [{ id: versionA, number: 9 }, { id: versionB, number: 10 }];
  assert.equal(latestVersion(versions), versionB);
  assert.equal(latestVersion({ items: versions }), versionB);
  assert.throws(() => latestVersion([]), /no Worker versions/);
  assert.throws(() => latestVersion([{ id: 'invalid', number: 100 }]), /invalid version/);
  assert.deepEqual(versions.map((v) => v.number), [9, 10], 'inspection must not reorder the caller’s response');
});

test('only this deployment run may resume a staged version from the same baseline', () => {
  assert.doesNotThrow(() => assertLatest(versionA, versionA));
  assert.doesNotThrow(() => assertLatest(versionA, versionB, { versionId: versionB, baselineVersion: versionA }));
  assert.throws(() => assertLatest(versionA, versionB), /unrecognized staged/);
  assert.throws(() => assertLatest(versionA, versionB, { versionId: versionB, baselineVersion: versionB }), /unrecognized staged/);
});

test('R2 list parsing distinguishes an empty account from a changed or failed CLI response', () => {
  assert.deepEqual(bucketNames('name:    pinplay-quiz-media\ncreation_date: 2026-01-01\n\nname: singing-private-songs\n'), ['pinplay-quiz-media', 'singing-private-songs']);
  assert.deepEqual(bucketNames('No buckets found.'), []);
  assert.deepEqual(bucketNames(''), []);
  assert.throws(() => bucketNames('Authentication failed'), /Could not read/);
  assert.throws(() => bucketNames('{"buckets":[]}'), /Could not read/);
});

test('bucket privacy requires confirmation for both public endpoints and custom domains', () => {
  const disabled = 'Public access via the r2.dev URL is disabled.';
  const noDomains = 'There are no custom domains connected to this bucket.';
  assert.doesNotThrow(() => assertPrivateBucket(disabled, noDomains));
  assert.throws(() => assertPrivateBucket('Public access is enabled: https://example.r2.dev', noDomains), /public or unrecognized/);
  assert.throws(() => assertPrivateBucket(disabled, 'Domain: music.example.com'), /custom domains/);
  assert.throws(() => assertPrivateBucket('', noDomains), /unrecognized/);
  assert.throws(() => assertPrivateBucket(disabled, ''), /custom domains/);
});

test('structured deploy records are scoped to the requested Worker and operation', () => {
  const rows = [
    { type: 'version-upload', worker_name: 'another-worker', version_id: versionB },
    { type: 'version-upload', worker_name: 'pinplay-api', version_id: versionA },
    { type: 'version-deploy', worker_name: 'pinplay-api', deployment_id: deploymentId },
  ].map((row) => JSON.stringify(row)).join('\n');
  assert.equal(deploymentRecord(rows, 'version-upload', 'pinplay-api').version_id, versionA);
  assert.equal(deploymentRecord(rows, 'version-deploy', 'pinplay-api').deployment_id, deploymentId);
  assert.throws(() => deploymentRecord(rows, 'version-upload', 'singing'), /did not confirm/);
  assert.throws(() => deploymentRecord('{"type":"version-upload","worker_name":"pinplay-api","version_id":"' + ZERO_UUID + '"}', 'version-upload', 'pinplay-api'), /dry run is not a deployment/);
  assert.throws(() => deploymentRecord('Uploaded successfully.', 'version-upload', 'pinplay-api'), /valid JSON/);
});

test('app addresses must be HTTPS origins without credentials, links or local paths', () => {
  assert.equal(applicationUrl('https://singing.example.workers.dev/'), 'https://singing.example.workers.dev');
  assert.equal(applicationUrl('https://singing.example.org'), 'https://singing.example.org');
  for (const url of ['http://localhost:8787', 'file:///C:/app', 'javascript:alert(1)', 'https://user:password@example.org', 'https://example.org/app', 'https://example.org/?key=value', 'https://example.org/#/assignments', 'not a URL']) {
    assert.throws(() => applicationUrl(url), /HTTPS/);
  }
});

test('generated Singing config pins the account and database and resolves paths without altering source', () => {
  const base = localSinging(), root = path.resolve('fixture & singing repo');
  const config = singingConfig(base, root, accountId, databaseId);
  assert.equal(config.account_id, accountId);
  assert.equal(config.main, path.join(root, 'cloudflare', 'worker.js'));
  assert.equal(config.assets.directory, path.join(root, '_site'));
  assert.equal(config.d1_databases[0].migrations_dir, path.join(root, 'cloudflare', 'migrations'));
  assert.equal(config.d1_databases[0].database_id, databaseId);
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.equal(config.$schema, undefined);
  assert.equal(base.d1_databases[0].database_id, ZERO_UUID);
  assert.equal(base.main, 'cloudflare/worker.js');
});

test('Singing deploy config rejects placeholder databases and reuse of PinPlay resources', () => {
  assert.throws(() => singingConfig(localSinging(), '.', accountId, ZERO_UUID), /real Singing database UUID/);
  assert.throws(() => singingConfig(localSinging(), '.', accountId, 'singing'), /real Singing database UUID/);
  const wrongDatabase = localSinging(); wrongDatabase.d1_databases[0].database_name = 'pinplay';
  assert.throws(() => singingConfig(wrongDatabase, '.', accountId, databaseId), /Singing’s own/);
  const publicMedia = localSinging(); publicMedia.r2_buckets[0].bucket_name = 'pinplay-quiz-media';
  assert.throws(() => singingConfig(publicMedia, '.', accountId, databaseId), /dedicated singing-private-songs/);
  const wrongIdentity = localSinging(); wrongIdentity.services[0].entrypoint = 'default';
  assert.throws(() => singingConfig(wrongIdentity, '.', accountId, databaseId), /service-only/);
});

test('companion config retains existing resource definitions and avoids changing version settings', () => {
  const raw = { ...localPinplay(), observability: { enabled: false }, logpush: false,
    tail_consumers: [{ service: 'existing-tail' }], streaming_tail_consumers: [{ service: 'existing-stream' }] };
  const directory = path.resolve('pinplay fixture', 'cloudflare');
  const config = pinplayConfig(raw, directory);
  assert.equal(config.main, path.join(directory, 'classroom-entry.mjs'));
  assert.deepEqual(config.durable_objects, raw.durable_objects);
  assert.deepEqual(config.migrations, raw.migrations);
  for (const key of ['observability', 'logpush', 'tail_consumers', 'streaming_tail_consumers']) assert.equal(config[key], undefined);
  assert.equal(raw.observability.enabled, false);
  const wrongMain = localPinplay(); wrongMain.main = 'worker.js';
  assert.throws(() => pinplayConfig(wrongMain, directory), /companion entrypoint/);
  const newMigration = localPinplay(); newMigration.migrations.push({ tag: 'v2', deleted_classes: ['QuizRoom'] });
  assert.throws(() => pinplayConfig(newMigration, directory), /unrelated Durable Object migrations/);
});

test('PinPlay live binding inspection permits existing variables and secrets without their values', () => {
  assert.doesNotThrow(() => assertPinplayBindings(livePinplay(), localPinplay()));
  const legacySigningKey = livePinplay();
  legacySigningKey.resources.bindings.find((b) => b.name === 'STUDENT_SESSION_KEY').name = 'CREATOR_SIGNING_KEY';
  legacySigningKey.resources.bindings.push({ name: 'CLASSROOM_SETTINGS', type: 'json' });
  assert.doesNotThrow(() => assertPinplayBindings(legacySigningKey, localPinplay()));
});

test('PinPlay binding inspection refuses unknown resources, changed bindings and missing identity secrets', () => {
  const unknown = livePinplay(); unknown.resources.bindings.push({ name: 'UNRELATED_DATA', type: 'kv_namespace', namespace_id: 'existing-kv' });
  assert.throws(() => assertPinplayBindings(unknown, localPinplay()), /UNRELATED_DATA/);
  const changedR2 = livePinplay(); changedR2.resources.bindings.find((b) => b.name === 'QUIZ_MEDIA').bucket_name = 'other-media';
  assert.throws(() => assertPinplayBindings(changedR2, localPinplay()), /bucket_name differs/);
  const changedRate = livePinplay(); changedRate.resources.bindings.find((b) => b.name === 'AUTH_RL').simple.limit = 1;
  assert.throws(() => assertPinplayBindings(changedRate, localPinplay()), /simple differs/);
  const wrongNamespace = livePinplay(); wrongNamespace.resources.bindings.find((b) => b.name === 'ROOMS').script_name = 'another-worker';
  assert.throws(() => assertPinplayBindings(wrongNamespace, localPinplay()), /script_name differs/);
  const missingResource = livePinplay(); missingResource.resources.bindings = missingResource.resources.bindings.filter((b) => b.name !== 'ROOMS');
  assert.throws(() => assertPinplayBindings(missingResource, localPinplay()), /absent in production/);
  const noSigningKey = livePinplay(); noSigningKey.resources.bindings = noSigningKey.resources.bindings.filter((b) => b.name !== 'STUDENT_SESSION_KEY');
  assert.throws(() => assertPinplayBindings(noSigningKey, localPinplay()), /session signing secret/);
});

test('PinPlay runtime changes require review before touching the existing Durable Object deployment', () => {
  const migration = livePinplay(); migration.resources.script_runtime.migration_tag = 'v2';
  assert.throws(() => assertPinplayBindings(migration, localPinplay()), /migration tag changed/);
  const runtime = livePinplay(); runtime.resources.script_runtime.compatibility_date = '2026-10-21';
  assert.throws(() => assertPinplayBindings(runtime, localPinplay()), /compatibility date differs/);
});

test('existing Singing deployment must retain its private database, bucket and identity service', () => {
  assert.doesNotThrow(() => assertSingingBindings(liveSinging(), databaseId));
  assert.throws(() => assertSingingBindings(liveSinging(), versionA), /another D1 database/);
  const wrongBucket = liveSinging(); wrongBucket.resources.bindings.find((b) => b.name === 'SONGS').bucket_name = 'pinplay-quiz-media';
  assert.throws(() => assertSingingBindings(wrongBucket, databaseId), /another media bucket/);
  const wrongIdentity = liveSinging(); wrongIdentity.resources.bindings.find((b) => b.name === 'IDENTITY').entrypoint = 'default';
  assert.throws(() => assertSingingBindings(wrongIdentity, databaseId), /identity binding differs/);
  const unknown = liveSinging(); unknown.resources.bindings.push({ name: 'UNRELATED_DB', type: 'd1', id: versionB });
  assert.throws(() => assertSingingBindings(unknown, databaseId), /Unexpected Singing binding/);
  const wrongRate = liveSinging(); wrongRate.resources.bindings.find((b) => b.name === 'AUTH_RL').type = 'kv_namespace';
  assert.throws(() => assertSingingBindings(wrongRate, databaseId), /rate-limit binding differs/);
  const wrongAssets = liveSinging(); wrongAssets.resources.bindings.find((b) => b.name === 'ASSETS').type = 'r2_bucket';
  assert.throws(() => assertSingingBindings(wrongAssets, databaseId), /assets binding differs/);
});
