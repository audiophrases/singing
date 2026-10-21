CREATE TABLE assignments (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL,
  due_at INTEGER, attempts_limit INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX assignments_owner ON assignments(owner_id, created_at);
CREATE TABLE assignment_targets (
  assignment_id TEXT NOT NULL REFERENCES assignments(id), class_id TEXT NOT NULL,
  PRIMARY KEY(assignment_id, class_id)
);
CREATE INDEX targets_class ON assignment_targets(class_id, assignment_id);
CREATE TABLE assignment_units (
  id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES assignments(id),
  song_id TEXT NOT NULL, revision INTEGER NOT NULL, activity TEXT NOT NULL, settings_json TEXT NOT NULL,
  FOREIGN KEY(song_id, revision) REFERENCES song_versions(song_id, revision)
);
CREATE INDEX units_assignment ON assignment_units(assignment_id);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY, unit_id TEXT NOT NULL REFERENCES assignment_units(id), student_id TEXT NOT NULL,
  student_name TEXT NOT NULL, ordinal INTEGER NOT NULL, seed INTEGER NOT NULL,
  started_at INTEGER NOT NULL, submitted_at INTEGER, position REAL NOT NULL DEFAULT 0,
  score REAL, max_score REAL, result_kind TEXT, result_json TEXT,
  UNIQUE(unit_id, student_id, ordinal)
);
CREATE UNIQUE INDEX one_open_attempt ON attempts(unit_id, student_id) WHERE submitted_at IS NULL;
CREATE INDEX attempts_student ON attempts(student_id, unit_id);
CREATE TABLE attempt_answers (
  attempt_id TEXT NOT NULL REFERENCES attempts(id), item_id INTEGER NOT NULL,
  answer TEXT NOT NULL, skipped INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(attempt_id, item_id)
);
