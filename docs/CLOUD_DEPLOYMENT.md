# Cloud classroom deployment

This implementation adds private song bundles, shared sign-in, Singing assignments
and results. Production resources and secrets must be inspected separately before
deploying. The old static host still plays built-in songs; new audio saves require
the cloud Worker and a teacher session.

## Windows quick start

For routine updates, double-click **`deploy-fast.bat`**, or open **`deploy.bat`**
and choose **1: Fast update Singing**. This builds and publishes only Singing,
reusing the saved account, database, bucket and shared authentication. It skips
PinPlay checkout/testing/deployment, the full Singing test suites, storage
provisioning and migration writes. Unchanged code needs no upload. Failed version
promotion can be retried without uploading the same code again.

Fast updates validate the Cloudflare account and live Singing bindings, preserve
variables/routes through version upload and promotion, and check for concurrent
releases. Changed database migrations, Worker configuration or shared identity
integration require the full deployment path. An older saved deployment gets a
one-time read-only check of its applied migration names before fast updates.

For first setup, install **Node.js 22 or later** (including npm) and **Git for
Windows**, then choose **2: Full setup / deployment** in **`deploy.bat`**. There
is no need to clone PinPlay manually, paste database IDs, install a global
Wrangler, or copy Cloudflare/PinPlay secrets. The launchers install the project's
pinned dependencies when needed and open Cloudflare's browser login if necessary.

The full deployment helper runs preparation first, shows the target account, PinPlay
source commit and production version, then asks you to type `DEPLOY` once before
making production changes. You can also use the individual launchers:

PinPlay's release uses its current `main` source plus the companion patch. If
`main` contains unrelated work that is not ready for production, release or
reconcile that work before confirming this deployment.

| File | What it does |
| --- | --- |
| `deploy-fast.bat` | Build and publish Singing only using its existing cloud setup, check public health, and open the app. No full test suites, PinPlay release or storage setup. |
| `deployment/01-prepare.bat` | Prepare an isolated PinPlay checkout, apply/check the identity patch, run the tests, build the static site, and dry-run both Workers. No production changes. |
| `deployment/02-deploy.bat` | Prepare and test, authenticate, inspect existing deployments, create/reuse private Singing R2 and D1, apply Singing migrations, release the identity adapter and Singing, run public smoke checks, and open the app. |
| `deployment/03-verify-and-open.bat` | Recheck R2 privacy, Singing bindings, the public page/API and authentication requirement, then open the app. |
| `deployment/04-google-login-setup.bat` | Show the exact Singing origin to allow and open Google's credentials page. Keep all existing authorized origins. |

Run the same deployment BAT again after an interruption. Use the fast launcher
for routine later releases and the full launcher for setup/integration changes.
Existing Singing resources are reused. Migration failures stop before Worker code
is released. A recorded staged version can be resumed; an unknown staged release
or concurrent rollout stops the helper rather than inheriting unreviewed settings.
No bucket objects, database records or shared identity secrets are deleted.

Local generated files live under **`.deployment/`**, which is ignored by Git and
excluded from the published site:

- `singing.production.json`: the real account/database IDs and absolute build paths.
  Source `wrangler.jsonc` keeps its local placeholder unchanged.
- `pinplay.production.json` and `pinplay/`: the isolated, patched companion source
  and release config. Source hashes catch unexpected edits before reuse.
- `state.json`, `releases/`, and command receipts: resource IDs, progress and previous
  production version IDs, including the original recovery baseline.
- `NEXT-STEPS.txt`: the live address, Google origin/client information, old-song
  migration instructions and recovery references.

The helper uses version upload/promotion for PinPlay, with `--keep-vars`; this
preserves its routes, domains, schedules, existing variables and secrets. Later
Singing code updates also use version promotion. For intentional changes to routes,
schedules or other deployment settings, use the manual workflow below and review
the Cloudflare configuration separately. Deployment checks refuse unexpected
bindings and different accounts/databases. Full setup and verification also
inspect R2 privacy and refuse public bucket access.

Two steps still require the service owner's browser:

1. Add the Singing origin to the existing Google OAuth web client's **Authorized
   JavaScript origins**. `04-google-login-setup.bat` opens the right console and
   shows the value; the helper cannot edit Google Cloud configuration through
   Cloudflare. Test real teacher/student sign-in and a private upload afterwards.
2. For songs stored at an old app address, publish the updated `_site/` build at
   that address and use the audio-inclusive transfer described below. The helper
   builds that folder, but does not push to GitHub or replace the old host.

For terminal/CI use, `node tools/deploy-cli.mjs update --yes` runs fast updates;
`node tools/deploy-cli.mjs deploy --yes` runs full deployment. Both skip the typed
confirmation and retain their workflow's deployment checks. `SINGING_DEPLOY_NO_PAUSE=1` avoids
the BAT's closing pause; `SINGING_DEPLOY_NO_BROWSER=1` prevents opening browser tabs.
On a machine without a saved app URL, `SINGING_DEPLOY_URL` can supply its public
HTTPS origin. Never put tokens or passwords in those settings or BAT files.

If a helper was forcibly stopped, its process lock is removed automatically only
after confirming the old process is no longer running. A second active helper is
refused. If source integration or live configuration has changed incompatibly,
resolve the reported difference rather than bypassing the check.

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
  The Windows helper prepares its own checkout under `.deployment/pinplay/`.
  The patch includes `cloudflare/classroom-entry.mjs`,
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
npm run test:deploy
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
It also checks login-free public play, teacher sign-in at `/create/`, assignment-only
student sign-in and the absence of upload/import controls from student screens.

Teachers should bookmark `/create/`. Studio, folder imports, backups and assignment
management require an authenticated teacher there. Students use the copied public
assignment link (`/#/assignment/...`) and sign in with their school Google account;
ordinary songs and games do not ask for login. The same origin serves both entry
points, so the existing Google authorized origin still applies. Older `/#/studio`
bookmarks redirect to `/create/#/studio`. The build generates the teacher entry
page automatically; no separate service, database or secret is needed.

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
   When deploying manually, set the actual database UUID in a release config;
   `wrangler.jsonc` has an intentional all-zero local placeholder. The Windows
   helper discovers the UUID and writes `.deployment/singing.production.json`.
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
API. Publish the generated `_site` folder, including `create/index.html`. Open
`create/` under that old app address and choose Export local backup with audio
(no sign-in needed). Then open `/create/` at the cloud address, sign in as a
teacher, and use Account → confirm permission → Import backup to cloud.
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

The Windows helper records the original production version IDs in
`.deployment/state.json` and a before-release record in `.deployment/releases/`.
For an administrator-reviewed PinPlay code rollback, use the saved UUID with the
project's pinned CLI, for example:

```
node node_modules/wrangler/bin/wrangler.js rollback SAVED_VERSION_UUID --config .deployment/pinplay.production.json --yes --message "Restore previous PinPlay code"
```

Rolling PinPlay back before the identity adapter also makes Singing cloud sign-in
unavailable. Do not delete databases or R2 objects as a rollback step.

## CLI references

The helper targets the pinned Wrangler version in `package-lock.json`. Command
behavior was checked against its installed help and the official
[Worker/version commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/),
[structured command output](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/),
[D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/),
and [R2 commands](https://developers.cloudflare.com/workers/wrangler/commands/r2/).
Cloudflare's [version upload binding inheritance](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/create/)
is why the helper checks both the active and latest uploaded version before release.
