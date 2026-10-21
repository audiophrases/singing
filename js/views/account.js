import { h, openModal, toast, clear } from '../ui.js';
import { cloudSession, onCloudSession, signIn, signOut } from '../cloud/session.js';
import { refreshCloudLibrary, migrateLocalSongs, importSongBackup } from '../cloud/library.js';
import { localUserSongs } from '../store.js';
import { createSongBackup } from '../media/backup.js';
import { getMedia } from '../media/store.js';

export function accountButton() {
  const button = h('button', { class: 'btn btn-sm', type: 'button', onclick: openAccount }, 'Sign in');
  const sync = (s) => { button.textContent = s.principal ? `☁ ${s.principal.displayName || 'My account'}` : '☁ Sign in'; };
  onCloudSession(sync); sync(cloudSession());
  return button;
}

export function openAccount() {
  const status = h('p', { class: 'small', role: 'status' });
  const body = h('div');
  const run = async (fn) => { try { await fn(); } catch (e) { status.textContent = e.message; } };
  const redraw = () => {
    clear(body); const s = cloudSession();
    const exportBackup = h('button', { class: 'btn', type: 'button', disabled: !localUserSongs().length, onclick: () => run(async () => {
      exportBackup.disabled = true;
      try {
        status.textContent = 'Preparing local backup with audio…';
        const { blob, count, missing } = await createSongBackup(localUserSongs(), getMedia);
        const url = URL.createObjectURL(blob);
        const link = h('a', { href: url, download: 'singing-local-songs.singing' });
        document.body.append(link); link.click();
        setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 1000);
        status.textContent = `${count} local song records backed up.${missing.length ? ` Missing files: ${missing.join(' · ')}` : ' Audio files included.'}`;
      } finally { exportBackup.disabled = false; }
    }) }, 'Export local backup with audio');
    body.append(h('p', { class: 'small' }, 'Moving from the old app address? Export your local songs here, then import the backup after signing in on the cloud app.'), exportBackup);
    if (!s.available) {
      body.append(h('p', null, 'Cloud sign-in is not connected on this host. Open the cloud-hosted Singing app to upload songs and access your library across devices.'));
      return;
    }
    if (s.principal) {
      body.append(h('p', null, `Signed in as ${s.principal.displayName || s.principal.email || s.principal.role}.`));
      if (s.principal.role !== 'student') {
        const rights = h('input', { type: 'checkbox' });
        const backupInput = h('input', { type: 'file', accept: '.singing', class: 'hidden', 'aria-label': 'Local song backup with audio' });
        const importBackup = h('button', { class: 'btn', type: 'button', onclick: () => {
          if (!rights.checked) { status.textContent = 'Confirm permission before importing a backup.'; return; }
          backupInput.click();
        } }, 'Import backup to cloud');
        backupInput.addEventListener('change', () => run(async () => {
          const file = backupInput.files[0]; if (!file) return;
          importBackup.disabled = true;
          try {
            const result = await importSongBackup(file, { rightsConfirmed: rights.checked, onProgress: (text) => { status.textContent = text; } });
            status.textContent = `${result.migrated} songs imported to your cloud library.${result.errors.length ? ` ${result.errors.join(' · ')}` : ''}`;
          } finally { importBackup.disabled = false; backupInput.value = ''; }
        }));
        body.append(h('p', null, 'Your cloud library is private. Assigned students will need to sign in to access their songs.'),
          h('label', { class: 'inline' }, rights, ' I have permission to store and use the songs I migrate.'),
          h('button', { class: 'btn', type: 'button', onclick: () => run(async () => {
            if (!rights.checked) throw new Error('Confirm your permission before migration.');
            status.textContent = 'Migrating…';
            const result = await migrateLocalSongs({ rightsConfirmed: true, onProgress: (text) => { status.textContent = text; } });
            status.textContent = `${result.migrated} songs migrated. Local originals were kept.${result.errors.length ? ` ${result.errors.join(' · ')}` : ''}`;
          }) }, `☁ Migrate local songs (${localUserSongs().length})`),
          importBackup, backupInput,
          h('button', { class: 'btn', type: 'button', onclick: () => run(async () => { await refreshCloudLibrary(); status.textContent = 'Cloud library refreshed.'; }) }, '↻ Refresh library'));
      }
      body.append(h('button', { class: 'btn', type: 'button', onclick: () => run(async () => { await signOut(); redraw(); location.hash = '#/'; }) }, 'Sign out'));
      return;
    }
    const password = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'PinPlay teacher password', 'aria-label': 'Teacher password' });
    const submit = async () => {
      const value = password.value; password.value = '';
      await signIn({ password: value }); await refreshCloudLibrary(); redraw(); window.dispatchEvent(new Event('hashchange')); toast('Signed in', 'ok');
    };
    password.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(submit); });
    body.append(h('p', null, 'Teachers can use their existing PinPlay owner password or workspace invitation. Students use their existing Google account.'), password,
      h('button', { class: 'btn primary', type: 'button', onclick: () => run(submit) }, 'Teacher sign in'));
    const invitation = h('input', { type: 'password', placeholder: 'Workspace invitation token', 'aria-label': 'Workspace invitation token' });
    body.append(h('details', null, h('summary', null, 'Teacher workspace invitation'), invitation,
      h('button', { class: 'btn', type: 'button', onclick: () => run(async () => {
        const value = invitation.value; invitation.value = ''; await signIn({ workspaceToken: value }); await refreshCloudLibrary(); redraw(); window.dispatchEvent(new Event('hashchange'));
      }) }, 'Use invitation')));
    if (s.googleClientId) {
      const google = h('div', { class: 'top-space' }); body.append(google);
      run(async () => {
        if (!window.google?.accounts?.id) await new Promise((resolve, reject) => {
          const script = h('script', { src: 'https://accounts.google.com/gsi/client', async: true, onload: resolve, onerror: () => reject(new Error('Could not load Google sign-in.')) });
          document.head.append(script);
        });
        if (!google.isConnected) return;
        window.google.accounts.id.initialize({ client_id: s.googleClientId, callback: (response) => run(async () => {
          await signIn({ googleIdToken: response.credential });
          if (cloudSession().principal.role !== 'student') await refreshCloudLibrary();
          redraw(); window.dispatchEvent(new Event('hashchange'));
        }) });
        window.google.accounts.id.renderButton(google, { theme: 'outline', size: 'large' });
      });
    }
  };
  redraw();
  return openModal([h('h2', null, '☁ Your Singing account'), body, status]);
}
