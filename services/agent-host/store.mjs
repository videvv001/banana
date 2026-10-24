// SQLite event log. Every durable fact about a conversation is an appended row with a monotonic `seq`,
// so any client (or a restarted service) resumes with "give me everything after seq N".
import { DatabaseSync } from 'node:sqlite';

export function openStore(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions(
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', cwd TEXT NOT NULL,
      started INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'idle', updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS events(
      seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
      kind TEXT NOT NULL, data TEXT NOT NULL, ts INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS events_session ON events(session_id, seq);
  `);
  const parse = (r) => ({ ...r, data: JSON.parse(r.data) });
  const p = {
    insertSession: db.prepare('INSERT INTO sessions(id, cwd, updated_at) VALUES(?, ?, ?)'),
    getSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    listSessions: db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC'),
    touch: db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?'),
    setStatus: db.prepare('UPDATE sessions SET status = ? WHERE id = ?'),
    setStarted: db.prepare('UPDATE sessions SET started = 1 WHERE id = ?'),
    setTitle: db.prepare('UPDATE sessions SET title = ? WHERE id = ?'),
    insertEvent: db.prepare('INSERT INTO events(session_id, kind, data, ts) VALUES(?, ?, ?, ?)'),
    after: db.prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq'),
    bySession: db.prepare('SELECT * FROM events WHERE session_id = ? ORDER BY seq'),
    maxSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM events'),
  };
  return {
    createSession: (id, cwd) => p.insertSession.run(id, cwd, Date.now()),
    getSession: (id) => p.getSession.get(id),
    listSessions: () => p.listSessions.all(),
    setStatus: (id, s) => p.setStatus.run(s, id),
    setStarted: (id) => p.setStarted.run(id),
    setTitle: (id, t) => p.setTitle.run(t, id),
    append(sessionId, kind, data) {
      const ts = Date.now();
      const { lastInsertRowid } = p.insertEvent.run(sessionId, kind, JSON.stringify(data), ts);
      p.touch.run(ts, sessionId);
      return { seq: Number(lastInsertRowid), session_id: sessionId, kind, data, ts };
    },
    eventsAfter: (seq) => p.after.all(seq).map(parse),
    sessionEvents: (id) => p.bySession.all(id).map(parse),
    maxSeq: () => p.maxSeq.get().m,
    close: () => db.close(),
  };
}
