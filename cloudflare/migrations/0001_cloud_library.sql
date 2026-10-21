PRAGMA foreign_keys = ON;
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, principal_id TEXT NOT NULL, role TEXT NOT NULL,
  csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE songs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft', deleted_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(owner_id, client_id)
);
CREATE INDEX songs_owner ON songs(owner_id, deleted_at, updated_at);
CREATE TABLE song_versions (
  song_id TEXT NOT NULL REFERENCES songs(id), revision INTEGER NOT NULL,
  manifest_key TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(song_id, revision)
);
CREATE TABLE assets (
  id TEXT PRIMARY KEY, song_id TEXT NOT NULL REFERENCES songs(id), owner_id TEXT NOT NULL,
  role TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  mime TEXT NOT NULL, size INTEGER NOT NULL CHECK(size > 0), checksum TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL,
  UNIQUE(song_id, role, checksum)
);
CREATE INDEX assets_owner ON assets(owner_id, state);
CREATE TABLE version_assets (
  song_id TEXT NOT NULL, revision INTEGER NOT NULL, role TEXT NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  PRIMARY KEY(song_id, revision, role),
  FOREIGN KEY(song_id, revision) REFERENCES song_versions(song_id, revision)
);
CREATE TABLE playback_grants (
  token_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  song_id TEXT NOT NULL, revision INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX playback_expiry ON playback_grants(expires_at);
