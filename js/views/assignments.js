import { h, clear, toast, openModal, confirmDialog } from '../ui.js';
import { api, cloudSession } from '../cloud/session.js';
import { renderSignIn } from './account.js';
import { teacherAccess, publicUrl } from '../cloud/access.js';
import { songPermissionCheckbox } from './song-permission.js';
import { allSongs } from '../store.js';
import { saveCloudSong } from '../cloud/library.js';
import { GAMES, gameFits } from '../games/index.js';

const field = (label, input) => h('label', { class: 'studio-field' }, h('span', null, label), input);
const run = async (fn) => { try { await fn(); } catch (e) { toast(e.message, 'bad', 5000); } };
const date = (value) => value ? new Date(value).toLocaleString() : 'No deadline';

export async function render(el, { id } = {}) {
  const principal = cloudSession().principal;
  if (!principal) {
    renderSignIn(el);
    return;
  }
  const isTeacher = teacherAccess();
  if (id) return detail(el, id, isTeacher);
  const { assignments } = await api('/api/assignments');
  const list = h('div');
  el.append(h('section', { class: 'card' }, h('h1', null, isTeacher ? 'Singing assignments' : 'My assignments'),
    h('p', { class: 'small' }, isTeacher ? 'Assign songs and native Singing activities to your classes. Attempt limits apply to each activity.' : 'Choose an assignment to practise, continue an attempt or see your results.'),
    isTeacher ? h('button', { class: 'btn primary', type: 'button', onclick: () => run(() => createAssignment()) }, '➕ Create assignment') : null,
    isTeacher && principal.role === 'owner' ? h('button', { class: 'btn', type: 'button', onclick: () => run(manageTeachers) }, 'Manage teachers') : null), list);
  if (!assignments.length) list.append(h('p', { class: 'empty' }, 'No assignments yet.'));
  for (const a of assignments) list.append(h('a', { class: 'card', href: `#/assignment/${a.id}`, style: { display: 'block', textDecoration: 'none', color: 'inherit' } },
    h('h2', null, a.title), h('p', { class: 'small' }, `${a.active ? 'Open' : 'Closed'} · ${date(a.due_at)} · ${a.attempts_limit} attempt(s) per activity`)));
}

async function createAssignment() {
  const { classes } = await api('/api/classes');
  const songs = allSongs();
  const songSelect = h('select', { 'aria-label': 'Assignment song' }, songs.map((s) => h('option', { value: s.id }, `${s.title}${s.cloud && s.status !== 'ready' ? ' (draft)' : ''}`)));
  const title = h('input', { placeholder: 'e.g. Friday listening practice', maxlength: 120, 'aria-label': 'Assignment title' });
  const due = h('input', { type: 'datetime-local', 'aria-label': 'Deadline' });
  const limit = h('select', { 'aria-label': 'Attempt limit' }, [1, 2, 3, 5, 10].map((n) => h('option', { value: n }, String(n))));
  const difficulty = h('select', { 'aria-label': 'Assignment difficulty' }, [['easy', 'Beginner'], ['medium', 'Intermediate'], ['hard', 'Advanced'], ['all', 'Expert']].map(([v, label]) => h('option', { value: v }, label)));
  const classInputs = classes.map((c) => ({ ...c, input: h('input', { type: 'checkbox', 'aria-label': c.name }) }));
  const activityInputs = GAMES.map((g) => ({ ...g, input: h('input', { type: 'checkbox', 'aria-label': g.name }) }));
  const activities = h('div', { class: 'assignment-options' });
  const drawActivities = () => {
    clear(activities); const s = songs.find((s) => s.id === songSelect.value);
    for (const g of activityInputs) {
      const fits = gameFits(g, s, (s.lines || s.synced || []).length);
      if (!fits) g.input.checked = false;
      g.input.disabled = !fits;
      activities.append(h('label', { class: 'inline' }, g.input, ` ${g.emoji} ${g.name}`));
    }
  };
  songSelect.addEventListener('change', drawActivities); drawActivities();
  const rights = songPermissionCheckbox();
  const status = h('p', { class: 'small', role: 'status' });
  const save = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
    save.disabled = true;
    try {
      if (!title.value.trim()) throw new Error('Give the assignment a title.');
      const selected = activityInputs.filter((g) => g.input.checked);
      if (!selected.length) throw new Error('Select at least one activity.');
      const targets = classInputs.filter((c) => c.input.checked).map((c) => c.id);
      if (!targets.length) throw new Error('Select at least one class. Manage your roster in PinPlay if no classes appear.');
      let song = songs.find((s) => s.id === songSelect.value);
      if (!song.cloud) {
        if (!rights.checked) throw new Error('Confirm permission to store this song.');
        song = await saveCloudSong({ ...song, source: song.source || 'band' }, { rightsConfirmed: true, onProgress: (text) => { status.textContent = text; } });
      }
      const result = await api('/api/assignments', { method: 'POST', body: {
        title: title.value.trim(), classIds: targets, dueAt: due.value ? new Date(due.value).getTime() : null,
        attemptsLimit: Number(limit.value), units: selected.map((g) => ({ songId: song.id, activity: g.id, settings: { level: difficulty.value } })),
      } });
      modal.close(); location.hash = `#/assignment/${result.id}`;
    } catch (e) { status.textContent = e.message; }
    finally { save.disabled = false; }
  } }, 'Create assignment');
  const modal = openModal([h('h2', null, 'Create a Singing assignment'), field('Title', title), field('Song', songSelect),
    h('p', { class: 'small' }, 'Recordings need an original MP3, karaoke MP3 and synchronized lyrics before assigning. Built-in songs can be assigned too.'),
    h('h3', null, 'Activities'), activities, field('Listening difficulty', difficulty),
    h('h3', null, 'Classes'), classInputs.length ? classInputs.map((c) => h('label', { class: 'inline' }, c.input, ` ${c.name}`)) : h('p', null, 'No permitted classes yet. Add students and their class in PinPlay, or ask your administrator to grant class access.'),
    field('Deadline (your local time)', due), field('Attempts per activity', limit),
    h('label', { class: 'inline small' }, rights, ' I have permission to store and use this song.'), status,
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => modal.close() }, 'Cancel'), save),
  ], { wide: true });
}

async function detail(el, id, isTeacher) {
  const { assignment, units } = await api(`/api/assignments/${id}`);
  const card = h('section', { class: 'card' }, h('a', { href: '#/assignments' }, '← Assignments'),
    h('h1', null, assignment.title), h('p', { class: 'small' }, `${date(assignment.due_at)} · ${assignment.attempts_limit} attempts per activity`));
  el.append(card);
  if (isTeacher) {
    const link = publicUrl(`#/assignment/${id}`);
    card.append(h('label', null, 'Student link (sign-in and class membership required)', h('input', { value: link, readonly: true, onclick: (e) => e.target.select() })),
      h('button', { class: 'btn', type: 'button', onclick: () => run(async () => { await navigator.clipboard.writeText(link); toast('Assignment link copied'); }) }, 'Copy student link'),
      assignment.active ? h('button', { class: 'btn', type: 'button', onclick: () => run(async () => {
        if (await confirmDialog('Close this assignment and revoke student song access through it?', { ok: 'Close assignment' })) {
          await api(`/api/assignments/${id}/close`, { method: 'POST', body: {} }); location.hash = '#/assignments';
        }
      }) }, 'Close assignment') : null);
  }
  for (const u of units) {
    const game = GAMES.find((g) => g.id === u.activity);
    const section = h('section', { class: 'card' }, h('h2', null, `${game?.emoji || '🎵'} ${game?.name || u.activity}`), h('p', null, u.songTitle));
    if (isTeacher) section.append(h('a', { class: 'btn', href: `#/play/${u.song_id}/${u.activity}` }, 'Preview activity'));
    else {
      const open = u.attempts.find((a) => !a.submitted_at);
      section.append(h('button', { class: 'btn primary', type: 'button', disabled: !assignment.active || (!open && u.attempts.length >= assignment.attempts_limit), onclick: () => run(async () => {
        const { attemptId } = await api(`/api/units/${u.id}/start`, { method: 'POST', body: {} });
        location.hash = `#/play/${u.song_id}/${u.activity}?attempt=${attemptId}`;
      }) }, open ? 'Continue attempt' : 'Start activity'));
      for (const a of u.attempts) section.append(h('p', { class: 'small' }, `Attempt ${a.ordinal}: ${a.submitted_at ? a.max_score ? `${a.score}/${a.max_score}${a.result_kind === 'browser-reported' ? ' (browser reported)' : ''}` : 'Completed' : 'In progress'}`));
    }
    el.append(section);
  }
  if (isTeacher) return results(el, id);
}

async function results(el, id) {
  const initial = await api(`/api/assignments/${id}/results`);
  const table = h('table', { class: 'results-table' }, h('thead', null, h('tr', null, ['Student', 'Activity', 'Attempt', 'Status', 'Result', 'Submitted'].map((s) => h('th', null, s)))));
  const tbody = h('tbody'); table.append(tbody);
  let rows = [];
  const summary = h('div', { class: 'small' });
  const draw = ({ attempts, students = [], unitCount = 0 }) => {
    rows = attempts.map((a) => [a.student_name, GAMES.find((g) => g.id === a.activity)?.name || a.activity, a.ordinal,
      a.submitted_at ? 'Completed' : 'In progress', a.max_score ? `${a.score}/${a.max_score} (${a.result_kind})` : a.score != null ? `${a.score} points (${a.result_kind})` : a.submitted_at ? 'Completion only' : '', a.submitted_at ? date(a.submitted_at) : '']);
    clear(summary);
    for (const student of students) {
      const completed = new Set(attempts.filter((a) => a.student_id === student.id && a.submitted_at).map((a) => a.unit_id)).size;
      summary.append(h('p', null, `${student.displayName}: ${completed}/${unitCount} activities completed`));
      if (!attempts.some((a) => a.student_id === student.id)) rows.push([student.displayName, 'All activities', '—', 'Not started', '', '']);
    }
    clear(tbody).append(...rows.map((row) => h('tr', null, row.map((value) => h('td', null, String(value))))));
  };
  draw(initial);
  const status = h('p', { class: 'small', role: 'status' });
  let alive = true;
  const refresh = async () => {
    try {
      const data = await api(`/api/assignments/${id}/results`);
      if (alive) { draw(data); status.textContent = 'Results updated.'; }
    } catch (e) { if (alive) status.textContent = e.message; }
  };
  const exportCsv = () => {
    const cell = (value) => {
      const text = String(value);
      const safe = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const csv = [['Student', 'Activity', 'Attempt', 'Status', 'Result', 'Submitted'], ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = h('a', { href: url, download: 'singing-results.csv' }); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  el.append(h('section', { class: 'card' }, h('h2', null, 'Student results'), h('p', { class: 'small' }, 'Word answers are checked on the server. Other measured scores are browser reported; singing and classroom activities can record completion only.'),
    h('button', { class: 'btn', type: 'button', onclick: exportCsv }, 'Download results CSV'),
    h('button', { class: 'btn', type: 'button', onclick: refresh }, 'Refresh results'), status, summary, h('div', { style: { overflowX: 'auto' } }, table)));
  const timer = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
  return () => { alive = false; clearInterval(timer); };
}

async function manageTeachers() {
  const { classes } = await api('/api/classes');
  const { teachers } = await api('/api/teachers');
  const email = h('input', { type: 'email', placeholder: 'teacher@school.org', 'aria-label': 'Teacher email' });
  const name = h('input', { placeholder: 'Display name', 'aria-label': 'Teacher name' });
  const options = classes.map((c) => ({ ...c, checkbox: h('input', { type: 'checkbox' }) }));
  const active = h('input', { type: 'checkbox', checked: true });
  const status = h('p', { role: 'status', class: 'small' });
  const list = h('div');
  for (const teacher of teachers) list.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => {
    email.value = teacher.email; name.value = teacher.displayName; active.checked = teacher.active;
    for (const c of options) c.checkbox.checked = teacher.classIds.includes(c.id);
  } }, `${teacher.displayName} (${teacher.active ? 'active' : 'revoked'})`));
  openModal([h('h2', null, 'Shared teacher access'), h('p', null, 'Teachers sign in with the Google account listed here. Grant access only to the classes they manage.'), list,
    field('Google email', email), field('Name', name), options.map((c) => h('label', { class: 'inline' }, c.checkbox, ` ${c.name}`)),
    h('label', { class: 'inline' }, active, ' Teacher access enabled'), status,
    h('button', { class: 'btn primary', type: 'button', onclick: () => run(async () => {
      await api('/api/teachers', { method: 'POST', body: { email: email.value.trim(), displayName: name.value.trim(), active: active.checked, classIds: options.filter((c) => c.checkbox.checked).map((c) => c.id) } });
      status.textContent = 'Shared teacher access saved.';
    }) }, 'Save teacher access')]);
}
