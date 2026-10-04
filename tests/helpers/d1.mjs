// Minimal Cloudflare D1 stand-in on node:sqlite, enough for server/worker.js in tests.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

export function fakeD1(migrationsDir = new URL('../../server/migrations/', import.meta.url)) {
  const db = new DatabaseSync(':memory:');
  for (const f of fs.readdirSync(migrationsDir).sort()) db.exec(fs.readFileSync(new URL(f, migrationsDir), 'utf8'));
  const stmt = (sql, params = []) => ({
    bind: (...p) => stmt(sql, p),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => db.prepare(sql).run(...params),
    _run: () => db.prepare(sql).run(...params),
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => {
      db.exec('BEGIN');
      try { stmts.forEach((s) => s._run()); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
