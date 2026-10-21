# Cloud classroom deployment

This implementation adds private song bundles, shared sign-in, Singing assignments
and results. Production resources and secrets must be inspected separately before
deploying. The old static host still plays built-in songs; new audio saves require
the cloud Worker and a teacher session.

## Components

- `cloudflare/worker.js`: Singing API; same-origin assets and secure cookies.
- `cloudflare/migrations/`: Singing-only D1 tables. No PinPlay assignments or results.
- `singing-private-songs`: a dedicated **private** R2 bucket, with public development
  URLs and public custom domains disabled. Do not bind it to PinPlay's public media route.
- `IDENTITY`: a service binding to the named `ClassroomIdentity` entrypoint of
  `pinplay-api`. No PinPlay signing keys, owner passwords or Cloudflare credentials
  are provisioned into Singing. Session signing derives an application-specific
  key inside PinPlay so legacy PinPlay verifiers cannot accept Singing tokens.
- Companion PinPlay changes are included in `integrations/pinplay-classroom.patch`
  (apply from a PinPlay repository root with `git apply --check` before `git apply`).
  They are also prepared in the separate checkout
  `D:\Admin\pinplay-singing-integration`: `cloudflare/classroom-entry.mjs`,
  `classroom-identity.mjs`, additive directory handlers/helper exports in `worker.js`,
  and a changed Worker entry file in `cloudflare/wrangler.toml`.

The shared adapter verifies owner passwords and workspace invitations using the
existing PinPlay code. Google students use the existing roster and login policy.
Named teachers are registered by the owner under Singing → Assignments → Manage
teachers, and authenticate with their listed Google account. Teacher records and
class grants stay in the shared PinPlay directory. Existing PinPlay routes and
assignment records keep their original format and behavior.

Class identifiers currently derive from PinPlay's canonical class labels. Moving a
student to another class updates access immediately. Changing a label creates a
different class identifier, so review teacher grants and assignment targets when
renaming a class. This maintains compatibility with PinPlay's existing roster editor.

## Local checks

```
npm ci
npm test
npm run test:cloud
npm run check:worker
```

`test:cloud` uses isolated local D1/R2 resources and a mock identity upstream. It
does not access production. The PinPlay checkout has an additional
`node --test tests/classroom-identity.test.mjs` test against the actual shared
adapter and Durable Object handlers. `tools/test-cloud-server.mjs` is a loopback-only
browser fixture with synthetic identities; it is excluded from deployed assets.

For the browser smoke check, install Chromium with `npx playwright install chromium`,
run `npm run build` and `node tools/test-cloud-server.mjs`, then run `npm run
test:browser` in another terminal. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` optionally selects
an existing Chromium executable. It checks real Studio uploads, WAV conversion,
folder imports, grant renewal, student gameplay/results and repeatable migration.

For actual local development, build assets, apply migrations with `npm run
db:local`, and run both Workers locally. Singing's identity service binding must
resolve to the locally running PinPlay Worker. Never mark production bindings
`remote: true` for a test run. Local private sessions use Secure cookies; use a
loopback hostname or HTTPS.

## Production sequence

1. Confirm Cloudflare account and current PinPlay deployment. Record its current
   version ID. Confirm the source checkout matches the intended release; preserve
   all existing resource bindings and secret names/values.
2. Build/check the PinPlay companion entrypoint, then stage or deploy it using the
   existing PinPlay deployment workflow. The `QuizRoom` export is preserved; no
   Durable Object namespace or existing assignment data is migrated. Preserve
   dashboard-managed variables with `--keep-vars` if deploying with Wrangler;
   the existing TOML does not enumerate those variables.
3. Create the Singing private R2 bucket and Singing D1 database in that account.
   Set the actual database UUID in `wrangler.jsonc`; its all-zero value is an
   intentional local placeholder, not a production database.
4. Apply Singing's migrations to **that new database only**. Confirm R2 public
   access is disabled. Configure quotas appropriate to the account's budget.
5. Build the whitelisted static assets and deploy Singing on its own origin.
   A Workers hostname is sufficient for initial checks. Add the production
   frontend origin to the existing Google OAuth client's allowed JavaScript origins
   for Google sign-in. The public client ID is supplied through the identity service;
   Google and Cloudflare secret values never belong in frontend source.
6. Verify owner login, private uploads, second-device access, named teacher class
   scopes, Google student login, assignment attempts, results and logout. Check that
   anonymous/other-class users cannot read media or lyrics. Use only synthetic or
   explicitly authorized material for smoke tests.

The application does not need an R2 S3 API key: uploads and streaming use Worker
bindings. Production private media is never served by the static assets binding.
Assets are copied using a whitelist; server code, tests, deployment tooling, local
credentials and database files are excluded.

## Storage and migration behavior

Every recording is uploaded to R2. Non-MP3 originals are preserved as `sourceFile`
and converted in the browser to MP3 playback files. Each upload reserves quota,
checks byte length and SHA-256, and is retryable. Song saves commit an immutable
manifest after verifying uploaded objects. Assignment publication requires original
and karaoke MP3s plus timed lyrics; incomplete songs remain private teacher drafts.

Cross-device edits use revision checks. An old browser cannot silently overwrite
a newer song. Folder import identities are deterministic within the teacher's
library. New temporary browser media is removed after a verified cloud save;
legacy migration keeps the original local song records and blobs.

Migration runs on the browser and **origin** containing the old files. A new
Worker hostname cannot read IndexedDB from the old GitHub Pages origin. Publish
the updated static app at the old address first; it still works without the cloud
API. Open Account → Export local backup with audio there, then sign in as a teacher
at the cloud address, confirm permission, and choose Import backup to cloud.
The `.singing` transfer includes binary originals/stems, lyrics and metadata;
checksums detect damaged files, retries deduplicate, and the original browser data
is retained. Export is available even without cloud sign-in. An ordinary JSON
backup does not contain audio. Missing files are reported per song. Old classroom
scores are not attributed to authenticated students.

## Results and safeguards

Assignments pin song versions and server-selected settings/seeds. Each activity
has its own attempt limit. Concurrent starts resume one open attempt. Deadlines
and ownership are checked server-side. Word answers for Choose the word and Fill
the gaps are regraded on the server, ignoring client-supplied totals. Other
numerical measurements are explicitly browser-reported; singing/classroom
activities can record completion without an invented academic grade. Microphone
recordings are not uploaded. Bingo/Hot mic have a manual practice-completion button.

Private playback grants expire after ten minutes and require the same active
session and current assignment authorization on every request, including byte
ranges. Session cookies expire after eight hours, are HttpOnly/Secure/SameSite,
and mutations require a same-origin request and CSRF token. Account and class
revocation fail closed. Browser responses do not use shared media caching.

Song deletion is a soft deletion that immediately revokes playback. Media objects
and historical revisions are deliberately retained; do not delete storage prefixes
as an orphan cleanup shortcut. Daily scheduled cleanup deletes expired sessions
and playback grants only. Account storage quotas include reserved uploads and
retained revisions. Plan administrator-reviewed retention before raising quotas.

## Recovery

Preserve the previous Worker versions, old local originals and existing R2 objects.
Rolling back Worker code does not roll back D1/R2 data. Prefer forward fixes for
additive schema migrations. If the shared identity service is unavailable, private
operations refuse access; built-in public songs remain available. Log out remains
possible without a working shared identity service.
