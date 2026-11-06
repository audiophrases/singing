// All student entry points use these permissions, including media range requests.
export const SHARE_TTL = 7 * 24 * 60 * 60 * 1000;
export const ACCESS_LEASE = 60 * 1000;

export const assignmentExpiry = (row) => Math.min(row.expires_at ?? row.created_at + SHARE_TTL, row.due_at ?? Infinity);
export const accessInfo = (expiresAt, now = Date.now()) => ({
  expiresAt, serverNow: now, checkBy: Math.min(expiresAt, now + ACCESS_LEASE),
});

export function audience(principal, alias = 't') {
  const classes = principal.classIds || [];
  return {
    sql: `(${alias}.kind = 'student' AND ${alias}.target_id = ?${classes.length ? ` OR ${alias}.kind = 'class' AND ${alias}.target_id IN (${classes.map(() => '?').join(',')})` : ''})`,
    values: [principal.id, ...classes],
  };
}

async function permissions(env, songId, revision, principal) {
  const now = Date.now();
  const target = audience(principal);
  const versionSql = revision == null ? '' : ' AND l.revision = ?';
  const shares = await env.DB.prepare(`SELECT l.song_id, l.revision, MAX(l.expires_at) AS expires_at FROM share_links l
    JOIN songs s ON s.id = l.song_id
    WHERE ${songId == null ? 'EXISTS (SELECT 1 FROM saved_songs b WHERE b.song_id = l.song_id AND b.student_id = ?)' : 'l.song_id = ?'}
    AND s.deleted_at IS NULL AND l.revoked_at IS NULL AND l.expires_at > ?${versionSql}
    AND EXISTS (SELECT 1 FROM share_targets t WHERE t.share_id = l.id AND ${target.sql})
    GROUP BY l.song_id, l.revision`)
    .bind(songId ?? principal.id, now, ...(revision == null ? [] : [revision]), ...target.values).all();
  const permissions = [...shares.results];
  if (principal.classIds?.length) {
    const assigned = await env.DB.prepare(`SELECT u.song_id, u.revision, MAX(MIN(a.expires_at, COALESCE(a.due_at, a.expires_at))) AS expires_at FROM assignments a
      JOIN assignment_units u ON u.assignment_id = a.id JOIN songs s ON s.id = u.song_id
      WHERE ${songId == null ? 'EXISTS (SELECT 1 FROM saved_songs b WHERE b.song_id = u.song_id AND b.student_id = ?)' : 'u.song_id = ?'}
      AND s.deleted_at IS NULL AND a.active = 1 AND a.expires_at > ?
      AND (a.due_at IS NULL OR a.due_at > ?)${revision == null ? '' : ' AND u.revision = ?'}
      AND EXISTS (SELECT 1 FROM assignment_targets t WHERE t.assignment_id = a.id
        AND t.class_id IN (${principal.classIds.map(() => '?').join(',')}))
      GROUP BY u.song_id, u.revision`)
      .bind(songId ?? principal.id, now, now, ...(revision == null ? [] : [revision]), ...principal.classIds).all();
    permissions.push(...assigned.results);
  }
  // An explicitly renewed permission can restore a bookmark, never an old URL.
  permissions.sort((a, b) => b.revision - a.revision || b.expires_at - a.expires_at);
  return { rows: permissions, now };
}

export async function studentAccess(env, songId, revision, principal) {
  if (principal.role !== 'student') return null;
  const { rows, now } = await permissions(env, songId, revision, principal);
  const best = rows[0];
  return best ? { revision: best.revision, ...accessInfo(best.expires_at, now) } : null;
}

export async function savedStudentAccess(env, principal) {
  const { rows, now } = await permissions(env, null, null, principal);
  const access = new Map();
  for (const row of rows) if (!access.has(row.song_id)) access.set(row.song_id, { revision: row.revision, ...accessInfo(row.expires_at, now) });
  return access;
}
