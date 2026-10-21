import { h, openModal, toast, clear } from '../ui.js';
import { cloudSession, onCloudSession, signIn, signOut } from '../cloud/session.js';
import { refreshCloudLibrary, migrateLocalSongs, importSongBackup } from '../cloud/library.js';
import { localUserSongs } from '../store.js';
import { createSongBackup } from '../media/backup.js';
import { getMedia } from '../media/store.js';
import { teacherArea, isTeacher, publicUrl } from '../cloud/access.js';

export function accountButton() {
  const button = h('button', { class: 'btn btn-sm', type: 'button', hidden: true, onclick: () => openAccount() });
  const sync = (s) => { button.textContent = `☁ ${s.principal?.displayName || 'My account'}`; };
  onCloudSession(sync); sync(cloudSession());
  return button;
}

export function openAccount() {
  if (!teacherArea() && !cloudSession().principal) return;
  const panel = accountContent({ teacher: teacherArea(), onChanged: () => { modal.close(); window.dispatchEvent(new Event('hashchange')); } });
  const modal = openModal([h('h2', null, 'Your Singing account'), panel.body, panel.status]);
  return modal;
}

export function renderSignIn(el, { teacher = false } = {}) {
  const panel = accountContent({ teacher, onChanged: () => window.dispatchEvent(new Event('hashchange')) });
  el.append(h('section', { class: 'card account-card' },
    h('h1', null, teacher ? 'Teacher access' : 'Sign in for your assignment'),
    h('p', null, teacher ? 'Manage your songs, classes and assignments here. Use your existing PinPlay teacher account.' : 'Use the school Google account your teacher has added to the class. Your assignment will open after sign-in.'),
    panel.body, panel.status,
    h('p', { class: 'small' }, h('a', { href: publicUrl('#/') }, 'Play Singing without signing in'))));
}

function accountContent({ teacher, onChanged }) {
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
    if (teacher && (!s.principal || isTeacher(s.principal)) && localUserSongs().length) {
      body.append(h('p', { class: 'small' }, 'Moving from the old app address? Export your local songs here, then import the backup after signing in on the cloud app.'), exportBackup);
    }
    if (!s.available) {
      body.append(h('p', null, teacher
        ? 'Cloud sign-in is not connected on this host. Open the cloud-hosted Singing app to upload songs and access your library across devices.'
        : 'Assignment sign-in is not connected on this host. Ask your teacher for the assignment link on the school app.'));
      return;
    }
    if (s.principal) {
      body.append(h('p', null, `Signed in as ${s.principal.displayName || s.principal.email || s.principal.role}.`));
      if (teacher && !isTeacher(s.principal)) body.append(h('p', null, 'This is the teacher area. You are signed in as a student. Open your assignment link, or sign out to use a teacher account.'));
      if (teacher && isTeacher(s.principal)) {
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
      body.append(h('button', { class: 'btn', type: 'button', onclick: () => run(async () => { await signOut(); onChanged(); }) }, 'Sign out'));
      return;
    }
    const finishSignIn = async (credentials) => {
      await signIn(credentials);
      if (teacher && isTeacher()) await refreshCloudLibrary();
      onChanged(); toast('Signed in', 'ok');
    };
    if (teacher) {
      const password = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'PinPlay teacher password', 'aria-label': 'Teacher password' });
      const submit = async () => {
        const value = password.value; password.value = '';
        await finishSignIn({ password: value });
      };
      password.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(submit); });
      body.append(h('p', null, 'Use your teacher password, Google account or workspace invitation.'), password,
        h('button', { class: 'btn primary', type: 'button', onclick: () => run(submit) }, 'Teacher sign in'));
      const invitation = h('input', { type: 'password', placeholder: 'Workspace invitation token', 'aria-label': 'Workspace invitation token' });
      body.append(h('details', null, h('summary', null, 'Teacher workspace invitation'), invitation,
        h('button', { class: 'btn', type: 'button', onclick: () => run(async () => {
          const value = invitation.value; invitation.value = ''; await finishSignIn({ workspaceToken: value });
        }) }, 'Use invitation')));
    }
    if (s.googleClientId) {
      const google = h('div', { class: 'top-space' }); body.append(google);
      run(async () => {
        if (!window.google?.accounts?.id) await new Promise((resolve, reject) => {
          const script = h('script', { src: 'https://accounts.google.com/gsi/client', async: true, onload: resolve, onerror: () => reject(new Error('Could not load Google sign-in.')) });
          document.head.append(script);
        });
        await Promise.resolve();
        if (!google.isConnected) return;
        window.google.accounts.id.initialize({ client_id: s.googleClientId, callback: (response) => run(async () => {
          await finishSignIn({ googleIdToken: response.credential });
        }) });
        window.google.accounts.id.renderButton(google, { theme: 'outline', size: 'large' });
      });
    } else if (!teacher) body.append(h('p', null, 'Student Google sign-in is not configured on this host. Ask your teacher for the assignment link on the school app.'));
  };
  redraw();
  return { body, status };
}
