-- The student who made a song saved from the Song maker, shown only to the owner.
ALTER TABLE songs ADD COLUMN made_by TEXT;
-- The owner account, recorded when the owner opens their library. Songs saved by
-- students arrive in the library of this account.
CREATE TABLE site_owner (id INTEGER PRIMARY KEY CHECK (id = 1), principal_id TEXT NOT NULL, seen_at INTEGER NOT NULL);
