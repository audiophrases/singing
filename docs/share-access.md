# Expiring student access

Teacher share links grant seven days of access from creation to selected classes or students. A student signs in with the existing school account. A forwarded link does not authorize another account. Links pin the song revision that was shared.

Saving a shared song stores a bookmark in the student's account. The bookmark list contains titles and access status, never lyrics or recordings. Opening it checks current permission on the server. An expired bookmark remains visible and locked. A replacement permission for that student or class restores the same bookmark, without reactivating the old URL. Any other explicitly valid permission for the song can still allow access.

The same permission check protects lyrics, song activities, artwork, original audio, karaoke and vocals. Audio passes are tied to the signed-in session and capped at the underlying permission expiry. Every media request checks permission again. Students cannot obtain the uploaded source file, print protected songs, remix them or save an unrestricted copy through the app.

An open protected page uses a short server-issued lease. It rechecks access at most every 30 seconds and clears the player, buffers and lyrics at the expiry boundary, on an offline event, or on a failed check. The lease lasts at most 60 seconds and uses elapsed time so changing the device calendar cannot extend it. Early revocation blocks server requests immediately; an already open page detects revocation on its next check. Reopening or choosing **Check access again** requires an online check.

Assignments also grant at most seven days from creation, ending earlier if their deadline is sooner. Their attempt endpoints cannot return song content after access ends. Closing an assignment revokes its permission. Teacher originals, student-created Song maker songs and the public player retain their existing ownership behavior.

Protected sharing makes a song private. Songs that have entered protected sharing cannot subsequently be published through the public toggle. Public songs must be made private before creating an expiring share. Legacy self-contained `#/s/` links are retired in the updated app. Previously distributed public copies, old browser copies and recordings made outside the app cannot be recalled. Share tokens are not sent to external QR-code services.

## Rollout

Apply `cloudflare/migrations/0005_expiring_shares.sql` through the existing D1 migration workflow before deploying the new Worker. It adds share permissions and bookmarks without deleting songs or results. Existing assignments receive an expiry of their original creation time plus seven days, and their songs become private. Assignments older than seven days therefore stop granting student access immediately after rollout.

Use **Full setup / deployment (menu 2)** for the first rollout. It applies migrations before releasing code. The fast-update workflow deliberately refuses an unapplied migration; subsequent updates can use it normally.

## Validation

- `npm test`: unit tests, including lease timing, stale responses and offline cleanup.
- `npm run test:cloud`: isolated Workers/D1/R2 tests for expiry, renewal, recipients, assignment deadlines, revisions and media revocation.
- `npm run test:shares`: builds the site and runs an isolated browser flow with synthetic audio. Uses Playwright's installed browser, or `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when set.
- `npm run check:worker`: builds and packages the Worker with Wrangler's dry run.

Browser fixture controls use a parent-process IPC channel and are never part of the deployed site or reachable through HTTP. Tests do not use production accounts or resources.
