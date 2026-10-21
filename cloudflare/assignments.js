import { bodyJson, json, requireThat, safeId } from './http.js';
import { teacher, identity } from './auth.js';
import { ownedSong, manifest, visibleSong } from './songs.js';
import { pickGaps } from '../js/lyrics/gaps.js';
import { checkAnswer } from '../js/lyrics/text.js';
import { timelineFromSynced, timelineFromCompiled } from '../js/music/timeline.js';
import { compileSong } from '../js/music/score.js';

const ACTIVITIES = new Set(['karaoke', 'echo', 'round', 'pitch', 'gapfill', 'choose', 'wrongword', 'order', 'bingo', 'finish', 'builder', 'hotmic', 'freeze', 'rhyme', 'hunt', 'speak', 'quiz']);
export async function accessibleAssignment(env, id, principal) {
  const row = await env.DB.prepare('SELECT * FROM assignments WHERE id = ?').bind(id).first();
  requireThat(row, 404, 'Assignment not found.');
  if (principal.role === 'student') {
    const { results } = await env.DB.prepare('SELECT class_id FROM assignment_targets WHERE assignment_id = ?').bind(id).all();
    requireThat(row.active && results.some((target) => principal.classIds?.includes(target.class_id)), 404, 'Assignment not found for your class.');
  } else requireThat(row.owner_id === principal.id, 404, 'Assignment not found.');
  return row;
}
export async function assignedVersion(env, songId, revision, principal) {
  const { results } = await env.DB.prepare(`SELECT DISTINCT a.id FROM assignments a
    JOIN assignment_units u ON u.assignment_id = a.id WHERE u.song_id = ? AND u.revision = ? AND a.active = 1`).bind(songId, revision).all();
  for (const row of results) {
    try { await accessibleAssignment(env, row.id, principal); return true; } catch (e) { if (e.status !== 404) throw e; }
  }
  return false;
}
function checkDeadline(assignment) {
  requireThat(assignment.active, 410, 'This assignment is closed.');
  requireThat(!assignment.due_at || Date.now() <= assignment.due_at, 410, 'The deadline for this assignment has passed.');
}
async function attemptContext(env, id, principal) {
  const row = await env.DB.prepare(`SELECT t.*,u.assignment_id,u.song_id,u.revision,u.activity,u.settings_json
    FROM attempts t JOIN assignment_units u ON u.id = t.unit_id WHERE t.id = ? AND t.student_id = ?`).bind(id, principal.id).first();
  requireThat(row, 404, 'Attempt not found.');
  const assignment = await accessibleAssignment(env, row.assignment_id, principal);
  const available = await env.DB.prepare('SELECT id FROM songs WHERE id = ? AND deleted_at IS NULL').bind(row.song_id).first();
  requireThat(available, 410, 'This song has been withdrawn.');
  return { row, assignment };
}
function taskWords(song, activity, settings, seed) {
  const timeline = song.source === 'band' || !song.source
    ? timelineFromCompiled(compileSong(song), song.bpm) : timelineFromSynced(song.synced, song.duration || 0);
  const gaps = pickGaps(timeline, { mode: settings.focus ? `cat:${settings.focus}` : settings.level || 'easy', seed });
  const words = [];
  for (const line of timeline.lines) for (const index of [...(gaps.get(line.index) || [])].sort((a, b) => a - b)) words.push(line.words[index].text.replace(/^[^A-Za-z0-9'’]+|[^A-Za-z0-9'’]+$/g, ''));
  return words;
}

export async function assignmentRoutes(request, env, path, principal) {
  if (path === '/api/classes' && request.method === 'GET') {
    teacher(principal); return json(await identity(env, 'classes', { credential: principal.credential }));
  }
  if (path === '/api/teachers' && request.method === 'GET') {
    requireThat(principal.role === 'owner', 403, 'Administrator access required.');
    return json(await identity(env, 'teachers', { credential: principal.credential }));
  }
  if (path === '/api/teachers' && request.method === 'POST') {
    requireThat(principal.role === 'owner', 403, 'Administrator access required.');
    const body = await bodyJson(request, 8192);
    return json(await identity(env, 'teachers/save', { ...body, credential: principal.credential }));
  }
  if (path === '/api/assignments' && request.method === 'GET') {
    let rows;
    if (principal.role === 'student') {
      if (!principal.classIds?.length) return json({ assignments: [] });
      rows = (await env.DB.prepare(`SELECT DISTINCT a.* FROM assignments a JOIN assignment_targets t ON t.assignment_id = a.id
        WHERE a.active = 1 AND t.class_id IN (${principal.classIds.map(() => '?').join(',')}) ORDER BY a.created_at DESC LIMIT 200`).bind(...principal.classIds).all()).results;
    } else rows = (await env.DB.prepare('SELECT * FROM assignments WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200').bind(principal.id).all()).results;
    return json({ assignments: rows });
  }
  if (path === '/api/assignments' && request.method === 'POST') {
    teacher(principal);
    const body = await bodyJson(request, 32768);
    requireThat(typeof body.title === 'string' && body.title.trim() && body.title.length <= 120, 400, 'Assignment title required.');
    requireThat(Array.isArray(body.classIds) && body.classIds.length > 0 && body.classIds.length <= 30, 400, 'Select at least one class.');
    const { classes } = await identity(env, 'classes', { credential: principal.credential });
    requireThat(body.classIds.every((id) => classes.some((c) => c.id === id)), 403, 'You can only assign to your own classes.');
    requireThat(Number.isInteger(body.attemptsLimit) && body.attemptsLimit >= 1 && body.attemptsLimit <= 10, 400, 'Attempt limit must be between 1 and 10 per activity.');
    const dueAt = body.dueAt == null ? null : Number(body.dueAt);
    requireThat(dueAt == null || Number.isSafeInteger(dueAt) && dueAt > Date.now(), 400, 'Choose a future deadline.');
    requireThat(Array.isArray(body.units) && body.units.length > 0 && body.units.length <= 30, 400, 'Select songs and activities.');
    const id = crypto.randomUUID(); const units = [];
    for (const input of body.units) {
      requireThat(ACTIVITIES.has(input.activity) && safeId(input.songId), 400, 'Invalid song or activity.');
      const song = await ownedSong(env, input.songId, principal);
      requireThat(song.status === 'ready', 400, 'Complete the original MP3, karaoke MP3 and synchronized lyrics before assigning this song.');
      const doc = await manifest(env, song.id, song.revision);
      if (input.activity === 'round') requireThat(doc.round && (doc.source === 'band' || !doc.source), 400, 'Round requires a song written as a round.');
      if (input.activity === 'pitch') requireThat(doc.source === 'band' || !doc.source || doc.synced?.some((l) => l.notes?.some((n) => Number.isFinite(n[2]))), 400, 'Pitch Pal requires melody notes.');
      if (input.activity === 'order') {
        const timeline = doc.source === 'band' || !doc.source ? timelineFromCompiled(compileSong(doc), doc.bpm) : timelineFromSynced(doc.synced, doc.duration || 0);
        requireThat(timeline.lines.filter((l) => !l.instrumental).length >= 4, 400, 'Line order requires at least four sung lines.');
      }
      const settings = { level: ['easy', 'medium', 'hard', 'all'].includes(input.settings?.level) ? input.settings.level : 'easy', input: input.settings?.input === 'bank' ? 'bank' : 'type', focus: '' };
      units.push({ id: crypto.randomUUID(), songId: song.id, revision: song.revision, activity: input.activity, settings });
    }
    await env.DB.batch([
      env.DB.prepare('INSERT INTO assignments (id,owner_id,title,due_at,attempts_limit,created_at) VALUES (?,?,?,?,?,?)').bind(id, principal.id, body.title.trim(), dueAt, body.attemptsLimit, Date.now()),
      ...[...new Set(body.classIds)].map((classId) => env.DB.prepare('INSERT INTO assignment_targets (assignment_id,class_id) VALUES (?,?)').bind(id, classId)),
      ...units.map((u) => env.DB.prepare('INSERT INTO assignment_units (id,assignment_id,song_id,revision,activity,settings_json) VALUES (?,?,?,?,?,?)').bind(u.id, id, u.songId, u.revision, u.activity, JSON.stringify(u.settings))),
    ]);
    return json({ id }, 201);
  }
  const assignmentMatch = /^\/api\/assignments\/([\w-]+)(?:\/(results|close))?$/.exec(path);
  if (assignmentMatch) {
    const [, id, action] = assignmentMatch;
    const assignment = await accessibleAssignment(env, id, principal);
    if (action === 'close' && request.method === 'POST') {
      teacher(principal); await env.DB.prepare('UPDATE assignments SET active = 0 WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
    if (action === 'results' && request.method === 'GET') {
      teacher(principal);
      const { results: attempts } = await env.DB.prepare(`SELECT t.*,u.activity,u.song_id FROM attempts t
        JOIN assignment_units u ON u.id = t.unit_id WHERE u.assignment_id = ? ORDER BY t.student_name,t.started_at`).bind(id).all();
      const [{ classes }, { students: roster = [] }, targets, units] = await Promise.all([
        identity(env, 'classes', { credential: principal.credential }),
        identity(env, 'roster', { credential: principal.credential }),
        env.DB.prepare('SELECT class_id FROM assignment_targets WHERE assignment_id = ?').bind(id).all(),
        env.DB.prepare('SELECT id FROM assignment_units WHERE assignment_id = ?').bind(id).all(),
      ]);
      const names = new Set(classes.filter((c) => targets.results.some((t) => t.class_id === c.id)).map((c) => c.name));
      return json({ assignment, attempts, students: roster.filter((s) => names.has(s.className)), unitCount: units.results.length });
    }
    if (!action && request.method === 'GET') {
      const { results: units } = await env.DB.prepare('SELECT * FROM assignment_units WHERE assignment_id = ?').bind(id).all();
      const documents = await Promise.all(units.map(async (u) => ({ ...u, songTitle: (await manifest(env, u.song_id, u.revision)).title,
        attempts: principal.role !== 'student' ? [] : (await env.DB.prepare('SELECT id,ordinal,started_at,submitted_at,score,max_score,result_kind FROM attempts WHERE unit_id = ? AND student_id = ? ORDER BY ordinal').bind(u.id, principal.id).all()).results })));
      return json({ assignment, units: documents });
    }
  }
  const unit = /^\/api\/units\/([\w-]+)\/start$/.exec(path);
  if (unit && request.method === 'POST') {
    requireThat(principal.role === 'student', 403, 'Student sign-in required to record an attempt.');
    const row = await env.DB.prepare('SELECT * FROM assignment_units WHERE id = ?').bind(unit[1]).first();
    requireThat(row, 404, 'Activity not found.');
    const assignment = await accessibleAssignment(env, row.assignment_id, principal); checkDeadline(assignment);
    const existing = await env.DB.prepare('SELECT id FROM attempts WHERE unit_id = ? AND student_id = ? AND submitted_at IS NULL').bind(row.id, principal.id).first();
    if (existing) return json({ attemptId: existing.id, resumed: true });
    const id = crypto.randomUUID(); const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    try {
      await env.DB.prepare(`INSERT INTO attempts (id,unit_id,student_id,student_name,ordinal,seed,started_at)
        SELECT ?,?,?,?,COALESCE(MAX(ordinal),0)+1,?,? FROM attempts WHERE unit_id = ? AND student_id = ? HAVING COUNT(*) < ?`)
        .bind(id, row.id, principal.id, principal.displayName || 'Student', seed, Date.now(), row.id, principal.id, assignment.attempts_limit).run();
    } catch (error) {
      const racing = await env.DB.prepare('SELECT id FROM attempts WHERE unit_id = ? AND student_id = ? AND submitted_at IS NULL').bind(row.id, principal.id).first();
      if (racing) return json({ attemptId: racing.id, resumed: true });
      throw error;
    }
    requireThat(await env.DB.prepare('SELECT id FROM attempts WHERE id = ?').bind(id).first(), 409, 'Attempt limit reached for this activity.');
    return json({ attemptId: id });
  }
  const attempt = /^\/api\/attempts\/([\w-]+)(?:\/(answers|submit))?$/.exec(path);
  if (attempt) {
    const [, id, action] = attempt;
    const { row, assignment } = await attemptContext(env, id, principal);
    if (!action && request.method === 'GET') {
      const { results: answers } = await env.DB.prepare('SELECT item_id,answer,skipped FROM attempt_answers WHERE attempt_id = ?').bind(id).all();
      return json({ attempt: row, settings: { ...JSON.parse(row.settings_json), seed: row.seed }, answers, song: visibleSong(await manifest(env, row.song_id, row.revision), principal) });
    }
    if (action === 'answers' && request.method === 'POST') {
      checkDeadline(assignment); requireThat(!row.submitted_at, 409, 'This attempt is already submitted.');
      requireThat(['choose', 'gapfill'].includes(row.activity), 400, 'This activity does not submit word answers.');
      const body = await bodyJson(request, 4096);
      const doc = await manifest(env, row.song_id, row.revision);
      const words = taskWords(doc, row.activity, JSON.parse(row.settings_json), row.seed);
      requireThat(Number.isInteger(body.itemId) && body.itemId >= 0 && body.itemId < words.length && typeof body.answer === 'string' && body.answer.length <= 160, 400, 'Invalid answer.');
      await env.DB.prepare(`INSERT INTO attempt_answers (attempt_id,item_id,answer,skipped) SELECT ?,?,?,?
        WHERE EXISTS (SELECT 1 FROM attempts WHERE id = ? AND submitted_at IS NULL)
        ON CONFLICT(attempt_id,item_id) DO UPDATE SET answer = excluded.answer, skipped = excluded.skipped
        WHERE EXISTS (SELECT 1 FROM attempts WHERE id = ? AND submitted_at IS NULL)`)
        .bind(id, body.itemId, body.answer, body.skipped ? 1 : 0, id, id).run();
      return json({ ok: true });
    }
    if (action === 'submit' && request.method === 'POST') {
      if (row.submitted_at) return json({ score: row.score, max: row.max_score, kind: row.result_kind, submittedAt: row.submitted_at });
      checkDeadline(assignment);
      const body = await bodyJson(request, 16384);
      let score = null, max = null, kind = 'completion';
      if (['choose', 'gapfill'].includes(row.activity)) {
        const words = taskWords(await manifest(env, row.song_id, row.revision), row.activity, JSON.parse(row.settings_json), row.seed);
        const { results: answers } = await env.DB.prepare('SELECT item_id,answer,skipped FROM attempt_answers WHERE attempt_id = ?').bind(id).all();
        score = answers.reduce((sum, a) => {
          if (a.skipped) return sum;
          const checked = checkAnswer(a.answer, words[a.item_id]);
          return sum + (checked === 'right' ? 1 : checked === 'close' && row.activity === 'gapfill' && JSON.parse(row.settings_json).input === 'type' ? 0.7 : 0);
        }, 0);
        score = Math.round(score * 10) / 10;
        max = words.length; kind = 'checked-answers';
      } else if (Number.isFinite(body.score) && Number.isFinite(body.max) && body.max > 0) {
        score = Math.max(0, Math.min(body.score, body.max)); max = body.max; kind = 'browser-reported';
      } else if (Number.isFinite(body.score) && body.score >= 0) {
        score = Math.min(body.score, 1e9); kind = 'browser-reported';
      }
      await env.DB.prepare('UPDATE attempts SET submitted_at = ?, score = ?, max_score = ?, result_kind = ?, result_json = ? WHERE id = ? AND submitted_at IS NULL')
        .bind(Date.now(), score, max, kind, JSON.stringify({ title: String(body.title || '').slice(0, 120), text: String(body.text || '').slice(0, 500) }), id).run();
      const stored = await env.DB.prepare('SELECT score,max_score,result_kind,submitted_at FROM attempts WHERE id = ?').bind(id).first();
      return json({ score: stored.score, max: stored.max_score, kind: stored.result_kind, submittedAt: stored.submitted_at });
    }
  }
  return null;
}
