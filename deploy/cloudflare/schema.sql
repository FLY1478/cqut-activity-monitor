CREATE TABLE IF NOT EXISTS health_report(id INTEGER PRIMARY KEY CHECK(id=1), observed_ms INTEGER NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS health_state(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, issues TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS health_alarm(id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('fault','recovery')), issues TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','in_flight','accepted','rejected','unknown')), created_at TEXT NOT NULL, claimed_at TEXT, completed_at TEXT);
CREATE INDEX IF NOT EXISTS health_alarm_pending ON health_alarm(state,id);
