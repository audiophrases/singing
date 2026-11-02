-- Band songs the owner shows on the public player, which needs no sign-in.
ALTER TABLE songs ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
CREATE INDEX songs_public ON songs(is_public, deleted_at, updated_at);
-- Set the first time the owner opens their library. Until then the public player
-- plays the starter songs, and from then on only the owner's public songs.
CREATE TABLE public_library (id INTEGER PRIMARY KEY CHECK (id = 1), started_at INTEGER NOT NULL);
