import { env } from "cloudflare:test";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repo TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    description TEXT NOT NULL,
    screenshot_urls TEXT DEFAULT '[]',
    reporter_id TEXT DEFAULT '',
    reporter_name TEXT DEFAULT '',
    diagnosis TEXT DEFAULT '',
    fix_plan TEXT DEFAULT '',
    pr_url TEXT DEFAULT '',
    retry_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_feedbacks_status ON feedbacks(status);
CREATE INDEX IF NOT EXISTS idx_feedbacks_project ON feedbacks(project_id);

CREATE TABLE IF NOT EXISTS google_sheet_cursor (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_row INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO google_sheet_cursor (id, last_row) VALUES (1, 1);
`;

export async function migrateDb(): Promise<D1Database> {
  const statements = SCHEMA_SQL
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await env.DB.prepare(stmt).run();
  }
  return env.DB;
}

export function createTestProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "testproject",
    name: "Test Project",
    repo: "user/testproject",
    description: "A test project",
    ...overrides,
  };
}
