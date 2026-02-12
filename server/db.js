import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDb(rootDir) {
  const stateDir = join(rootDir, 'state');
  mkdirSync(stateDir, { recursive: true });
  const dbPath = join(stateDir, 'monitor.sqlite');
  const db = new DatabaseSync(dbPath);

  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      event TEXT NOT NULL,
      type TEXT NOT NULL,
      sessionKey TEXT,
      runId TEXT,
      tool TEXT,
      summary TEXT,
      payloadJson TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payloadJson TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(sessionKey, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_snapshots_kind_ts ON snapshots(kind, ts DESC);
  `);

  const insert = db.prepare(`
    INSERT INTO events (ts, event, type, sessionKey, runId, tool, summary, payloadJson)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const query = db.prepare(`
    SELECT id, ts, event, type, sessionKey, runId, tool, summary, payloadJson
    FROM events
    WHERE (?1 IS NULL OR type = ?1)
      AND (?2 IS NULL OR sessionKey LIKE ?2)
    ORDER BY ts DESC
    LIMIT ?3
  `);

  const insertSnap = db.prepare(`
    INSERT INTO snapshots (ts, kind, payloadJson)
    VALUES (?, ?, ?)
  `);

  const latestSnap = db.prepare(`
    SELECT id, ts, kind, payloadJson
    FROM snapshots
    WHERE kind = ?1
    ORDER BY ts DESC
    LIMIT 1
  `);

  const latestEventForSession = db.prepare(`
    SELECT id, ts, event, type, sessionKey, runId, tool, summary, payloadJson
    FROM events
    WHERE sessionKey = ?1
    ORDER BY ts DESC
    LIMIT 1
  `);

  return {
    db,
    insertEvent(row) {
      insert.run(
        row.ts,
        row.event,
        row.type,
        row.sessionKey ?? null,
        row.runId ?? null,
        row.tool ?? null,
        row.summary ?? null,
        row.payloadJson
      );
    },
    listEvents({ type, sessionKeyLike, limit }) {
      const t = type && type.trim() ? type.trim() : null;
      const s = sessionKeyLike && sessionKeyLike.trim() ? `%${sessionKeyLike.trim()}%` : null;
      const lim = Math.max(1, Math.min(1000, Number(limit ?? 100)));
      return query.all(t, s, lim);
    },
    insertSnapshot({ ts, kind, payloadJson }) {
      insertSnap.run(ts, kind, payloadJson);
    },
    latestSnapshot(kind) {
      return latestSnap.get(kind) ?? null;
    },
    latestEventForSession(sessionKey) {
      return latestEventForSession.get(sessionKey) ?? null;
    }
  };
}
