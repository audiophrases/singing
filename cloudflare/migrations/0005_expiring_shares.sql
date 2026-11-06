CREATE TABLE share_links (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
  song_id TEXT NOT NULL, revision INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, revoked_at INTEGER,
  FOREIGN KEY(song_id, revision) REFERENCES song_versions(song_id, revision)
);
CREATE INDEX shares_song ON share_links(song_id, expires_at);
CREATE INDEX shares_owner ON share_links(owner_id, created_at);
CREATE TABLE share_targets (
  share_id TEXT NOT NULL REFERENCES share_links(id),
  kind TEXT NOT NULL CHECK(kind IN ('class', 'student')), target_id TEXT NOT NULL,
  PRIMARY KEY(share_id, kind, target_id)
);
CREATE TABLE saved_songs (
  student_id TEXT NOT NULL, song_id TEXT NOT NULL REFERENCES songs(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(student_id, song_id)
);
ALTER TABLE assignments ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
UPDATE assignments SET expires_at = created_at + 604800000;
CREATE INDEX units_song ON assignment_units(song_id, revision);
ALTER TABLE songs ADD COLUMN access_controlled INTEGER NOT NULL DEFAULT 0;
UPDATE songs SET access_controlled = 1, is_public = 0 WHERE id IN (SELECT song_id FROM assignment_units);
