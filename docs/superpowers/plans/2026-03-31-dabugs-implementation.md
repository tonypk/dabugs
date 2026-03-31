# DaBugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an open-source tool where users report bugs via Telegram/Google Form, and Claude Code automatically diagnoses + creates fix PRs after developer confirmation.

**Architecture:** Cloudflare Worker (Hono + grammY + D1) handles feedback collection and API. A Claude Code custom skill runs via `/loop 5m /dabugs` to diagnose and fix bugs. A lightweight CLI (`dabugs`) manages setup and project configuration.

**Tech Stack:** TypeScript, Hono, grammY, Cloudflare Workers/D1/Cron Triggers, Google Sheets API v4

---

## File Structure

```
dabugs/
├── worker/
│   ├── src/
│   │   ├── index.ts              # Hono app + fetch/scheduled exports
│   │   ├── types.ts              # Env bindings, DB row types, API types
│   │   ├── middleware/
│   │   │   └── auth.ts           # Bearer token auth middleware
│   │   ├── routes/
│   │   │   ├── feedback.ts       # GET /api/pending, /api/confirmed, PATCH endpoints
│   │   │   └── projects.ts       # GET/POST /api/projects
│   │   ├── services/
│   │   │   ├── telegram.ts       # grammY bot setup, webhook handler, message sender
│   │   │   └── google-sheet.ts   # Google Sheet poller (JWT auth + fetch)
│   │   └── db/
│   │       ├── schema.sql        # D1 CREATE TABLE statements
│   │       └── queries.ts        # Typed query functions wrapping D1
│   ├── test/
│   │   ├── queries.test.ts       # DB query unit tests
│   │   ├── feedback.test.ts      # Feedback route tests
│   │   ├── projects.test.ts      # Projects route tests
│   │   └── helpers.ts            # Test fixtures + mock D1
│   ├── wrangler.toml
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
├── cli/
│   ├── src/
│   │   ├── index.ts              # CLI entry (commander)
│   │   ├── init.ts               # dabugs init command
│   │   ├── add-project.ts        # dabugs add-project command
│   │   └── config.ts             # Read/write ~/.dabugs/projects.json
│   ├── test/
│   │   ├── config.test.ts        # Config read/write tests
│   │   └── init.test.ts          # Init command tests
│   ├── package.json
│   └── tsconfig.json
├── skill/
│   └── dabugs.md                 # Claude Code custom skill
├── README.md
├── LICENSE
└── .gitignore
```

---

### Task 1: Project Scaffold + D1 Schema

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.toml`
- Create: `worker/vitest.config.ts`
- Create: `worker/src/types.ts`
- Create: `worker/src/db/schema.sql`
- Create: `.gitignore`
- Create: `LICENSE`

- [ ] **Step 1: Create worker/package.json**

```json
{
  "name": "dabugs-worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate:local": "wrangler d1 execute dabugs-db --local --file=src/db/schema.sql",
    "db:migrate:remote": "wrangler d1 execute dabugs-db --remote --file=src/db/schema.sql"
  },
  "dependencies": {
    "grammy": "^1.35.0",
    "hono": "^4.7.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "@cloudflare/workers-types": "^4.20250320.0",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0",
    "wrangler": "^4.10.0"
  }
}
```

- [ ] **Step 2: Create worker/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ESNext"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Create worker/wrangler.toml**

```toml
name = "dabugs"
main = "src/index.ts"
compatibility_date = "2025-03-28"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "dabugs-db"
database_id = "placeholder-replace-after-d1-create"

[triggers]
crons = ["*/5 * * * *"]

# Secrets (set via `wrangler secret put`):
# DABUGS_API_KEY
# BOT_TOKEN
# TELEGRAM_ADMIN_CHAT_ID
# GOOGLE_SERVICE_ACCOUNT_KEY
# GOOGLE_SHEET_ID
# TELEGRAM_WEBHOOK_SECRET
```

- [ ] **Step 4: Create worker/vitest.config.ts**

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          d1Databases: ["DB"],
        },
      },
    },
  },
});
```

- [ ] **Step 5: Create worker/src/types.ts**

```typescript
export interface Env {
  DB: D1Database;
  DABUGS_API_KEY: string;
  BOT_TOKEN: string;
  TELEGRAM_ADMIN_CHAT_ID: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  GOOGLE_SERVICE_ACCOUNT_KEY: string;
  GOOGLE_SHEET_ID: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  repo: string;
  description: string;
  created_at: string;
}

export interface FeedbackRow {
  id: number;
  project_id: string;
  source: "telegram" | "google_form";
  status: string;
  description: string;
  screenshot_urls: string;
  reporter_id: string;
  reporter_name: string;
  diagnosis: string;
  fix_plan: string;
  pr_url: string;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export type FeedbackStatus =
  | "pending"
  | "diagnosing"
  | "diagnosed"
  | "confirmed"
  | "fixing"
  | "fixed"
  | "rejected"
  | "needs_review";
```

- [ ] **Step 6: Create worker/src/db/schema.sql**

```sql
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
```

- [ ] **Step 7: Create root .gitignore**

```
node_modules/
dist/
.wrangler/
.dev.vars
*.log
.DS_Store
```

- [ ] **Step 8: Create LICENSE (MIT)**

```
MIT License

Copyright (c) 2026 DaBugs Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 9: Install dependencies**

Run: `cd /Users/anna/Documents/dabugs/worker && npm install`
Expected: node_modules created, lockfile generated

- [ ] **Step 10: Commit**

```bash
git add .gitignore LICENSE worker/package.json worker/package-lock.json worker/tsconfig.json worker/wrangler.toml worker/vitest.config.ts worker/src/types.ts worker/src/db/schema.sql
git commit -m "feat: project scaffold with D1 schema, types, and worker config"
```

---

### Task 2: Database Query Layer

**Files:**
- Create: `worker/src/db/queries.ts`
- Create: `worker/test/helpers.ts`
- Create: `worker/test/queries.test.ts`

- [ ] **Step 1: Create test helpers with D1 setup**

File: `worker/test/helpers.ts`

```typescript
import { env } from "cloudflare:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export async function migrateDb(): Promise<D1Database> {
  const schema = readFileSync(
    resolve(__dirname, "../src/db/schema.sql"),
    "utf-8"
  );
  const statements = schema
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
```

- [ ] **Step 2: Write failing tests for query functions**

File: `worker/test/queries.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { migrateDb, createTestProject } from "./helpers";
import {
  insertProject,
  listProjects,
  insertFeedback,
  listFeedbacksByStatus,
  updateFeedbackDiagnosis,
  updateFeedbackStatus,
} from "../src/db/queries";

describe("queries", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = await migrateDb();
  });

  describe("projects", () => {
    it("inserts and lists projects", async () => {
      const project = createTestProject();
      await insertProject(db, project);

      const projects = await listProjects(db);
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe("testproject");
      expect(projects[0].name).toBe("Test Project");
    });

    it("rejects duplicate project id", async () => {
      const project = createTestProject();
      await insertProject(db, project);
      await expect(insertProject(db, project)).rejects.toThrow();
    });
  });

  describe("feedbacks", () => {
    beforeEach(async () => {
      await insertProject(db, createTestProject());
    });

    it("inserts feedback and lists by status", async () => {
      await insertFeedback(db, {
        project_id: "testproject",
        source: "telegram",
        description: "Login broken",
        reporter_id: "123",
        reporter_name: "alice",
      });

      const pending = await listFeedbacksByStatus(db, "pending");
      expect(pending).toHaveLength(1);
      expect(pending[0].description).toBe("Login broken");
      expect(pending[0].status).toBe("pending");
    });

    it("updates feedback diagnosis", async () => {
      await insertFeedback(db, {
        project_id: "testproject",
        source: "telegram",
        description: "Login broken",
        reporter_id: "123",
        reporter_name: "alice",
      });

      const [feedback] = await listFeedbacksByStatus(db, "pending");
      const updated = await updateFeedbackDiagnosis(db, feedback.id, {
        diagnosis: "Missing await in submit handler",
        fix_plan: "Add async/await to handleSubmit()",
      });

      expect(updated.status).toBe("diagnosed");
      expect(updated.diagnosis).toBe("Missing await in submit handler");
    });

    it("updates feedback status", async () => {
      await insertFeedback(db, {
        project_id: "testproject",
        source: "telegram",
        description: "Login broken",
        reporter_id: "123",
        reporter_name: "alice",
      });

      const [feedback] = await listFeedbacksByStatus(db, "pending");
      const updated = await updateFeedbackStatus(db, feedback.id, {
        status: "confirmed",
      });

      expect(updated.status).toBe("confirmed");
    });

    it("updates status with pr_url", async () => {
      await insertFeedback(db, {
        project_id: "testproject",
        source: "telegram",
        description: "Login broken",
        reporter_id: "123",
        reporter_name: "alice",
      });

      const [feedback] = await listFeedbacksByStatus(db, "pending");
      const updated = await updateFeedbackStatus(db, feedback.id, {
        status: "fixed",
        pr_url: "https://github.com/user/repo/pull/1",
      });

      expect(updated.status).toBe("fixed");
      expect(updated.pr_url).toBe("https://github.com/user/repo/pull/1");
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/anna/Documents/dabugs/worker && npx vitest run`
Expected: FAIL — `Cannot find module '../src/db/queries'`

- [ ] **Step 4: Implement query functions**

File: `worker/src/db/queries.ts`

```typescript
import type { ProjectRow, FeedbackRow, FeedbackStatus } from "../types";

interface InsertProjectInput {
  id: string;
  name: string;
  repo: string;
  description?: string;
}

interface InsertFeedbackInput {
  project_id: string;
  source: "telegram" | "google_form";
  description: string;
  reporter_id?: string;
  reporter_name?: string;
  screenshot_urls?: string[];
}

interface DiagnoseInput {
  diagnosis: string;
  fix_plan: string;
}

interface StatusUpdateInput {
  status: FeedbackStatus;
  pr_url?: string;
}

export async function insertProject(
  db: D1Database,
  input: InsertProjectInput
): Promise<ProjectRow> {
  const row = await db
    .prepare(
      "INSERT INTO projects (id, name, repo, description) VALUES (?1, ?2, ?3, ?4) RETURNING *"
    )
    .bind(input.id, input.name, input.repo, input.description ?? "")
    .first<ProjectRow>();

  if (!row) throw new Error("Failed to insert project");
  return row;
}

export async function listProjects(db: D1Database): Promise<ProjectRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM projects ORDER BY created_at")
    .all<ProjectRow>();
  return results;
}

export async function insertFeedback(
  db: D1Database,
  input: InsertFeedbackInput
): Promise<FeedbackRow> {
  const screenshotJson = JSON.stringify(input.screenshot_urls ?? []);
  const row = await db
    .prepare(
      `INSERT INTO feedbacks (project_id, source, description, reporter_id, reporter_name, screenshot_urls)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       RETURNING *`
    )
    .bind(
      input.project_id,
      input.source,
      input.description,
      input.reporter_id ?? "",
      input.reporter_name ?? "",
      screenshotJson
    )
    .first<FeedbackRow>();

  if (!row) throw new Error("Failed to insert feedback");
  return row;
}

export async function listFeedbacksByStatus(
  db: D1Database,
  status: FeedbackStatus
): Promise<FeedbackRow[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM feedbacks WHERE status = ?1 ORDER BY created_at ASC"
    )
    .bind(status)
    .all<FeedbackRow>();
  return results;
}

export async function updateFeedbackDiagnosis(
  db: D1Database,
  id: number,
  input: DiagnoseInput
): Promise<FeedbackRow> {
  const row = await db
    .prepare(
      `UPDATE feedbacks
       SET diagnosis = ?1, fix_plan = ?2, status = 'diagnosed', updated_at = datetime('now')
       WHERE id = ?3
       RETURNING *`
    )
    .bind(input.diagnosis, input.fix_plan, id)
    .first<FeedbackRow>();

  if (!row) throw new Error(`Feedback ${id} not found`);
  return row;
}

export async function updateFeedbackStatus(
  db: D1Database,
  id: number,
  input: StatusUpdateInput
): Promise<FeedbackRow> {
  const row = await db
    .prepare(
      `UPDATE feedbacks
       SET status = ?1, pr_url = COALESCE(?2, pr_url), updated_at = datetime('now')
       WHERE id = ?3
       RETURNING *`
    )
    .bind(input.status, input.pr_url ?? null, id)
    .first<FeedbackRow>();

  if (!row) throw new Error(`Feedback ${id} not found`);
  return row;
}

export async function getFeedbackById(
  db: D1Database,
  id: number
): Promise<FeedbackRow | null> {
  return db
    .prepare("SELECT * FROM feedbacks WHERE id = ?1")
    .bind(id)
    .first<FeedbackRow>();
}

export async function incrementRetryCount(
  db: D1Database,
  id: number
): Promise<FeedbackRow> {
  const row = await db
    .prepare(
      `UPDATE feedbacks
       SET retry_count = retry_count + 1, updated_at = datetime('now')
       WHERE id = ?1
       RETURNING *`
    )
    .bind(id)
    .first<FeedbackRow>();

  if (!row) throw new Error(`Feedback ${id} not found`);
  return row;
}

export async function getGoogleSheetCursor(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT last_row FROM google_sheet_cursor WHERE id = 1")
    .first<{ last_row: number }>();
  return row?.last_row ?? 1;
}

export async function setGoogleSheetCursor(
  db: D1Database,
  lastRow: number
): Promise<void> {
  await db
    .prepare("UPDATE google_sheet_cursor SET last_row = ?1 WHERE id = 1")
    .bind(lastRow)
    .run();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/anna/Documents/dabugs/worker && npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add worker/src/db/queries.ts worker/test/helpers.ts worker/test/queries.test.ts
git commit -m "feat: D1 query layer with tests for projects and feedbacks"
```

---

### Task 3: Auth Middleware + Feedback API Routes

**Files:**
- Create: `worker/src/middleware/auth.ts`
- Create: `worker/src/routes/feedback.ts`
- Create: `worker/src/routes/projects.ts`
- Create: `worker/test/feedback.test.ts`
- Create: `worker/test/projects.test.ts`

- [ ] **Step 1: Write failing tests for feedback routes**

File: `worker/test/feedback.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { migrateDb } from "./helpers";
import app from "../src/index";

describe("feedback routes", () => {
  beforeEach(async () => {
    await migrateDb();
    await env.DB.prepare(
      "INSERT INTO projects (id, name, repo) VALUES ('testproj', 'Test', 'user/test')"
    ).run();
  });

  const headers = {
    Authorization: "Bearer test-api-key",
    "Content-Type": "application/json",
  };

  it("GET /api/pending returns empty array initially", async () => {
    const res = await app.request("/api/pending", { headers }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("POST /api/feedback creates a feedback", async () => {
    const res = await app.request(
      "/api/feedback",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          project_id: "testproj",
          source: "telegram",
          description: "Button broken",
          reporter_id: "123",
          reporter_name: "alice",
        }),
      },
      env
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(1);
    expect(body.status).toBe("pending");
  });

  it("PATCH /api/feedback/:id/diagnose updates diagnosis", async () => {
    await app.request(
      "/api/feedback",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          project_id: "testproj",
          source: "telegram",
          description: "Button broken",
        }),
      },
      env
    );

    const res = await app.request(
      "/api/feedback/1/diagnose",
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          diagnosis: "Missing click handler",
          fix_plan: "Add onClick to button",
        }),
      },
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("diagnosed");
    expect(body.diagnosis).toBe("Missing click handler");
  });

  it("PATCH /api/feedback/:id/status updates status", async () => {
    await app.request(
      "/api/feedback",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          project_id: "testproj",
          source: "telegram",
          description: "Button broken",
        }),
      },
      env
    );

    const res = await app.request(
      "/api/feedback/1/status",
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "confirmed" }),
      },
      env
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("confirmed");
  });

  it("rejects requests without API key", async () => {
    const res = await app.request("/api/pending", {}, env);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Write failing tests for project routes**

File: `worker/test/projects.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { migrateDb } from "./helpers";
import app from "../src/index";

describe("project routes", () => {
  beforeEach(async () => {
    await migrateDb();
  });

  const headers = {
    Authorization: "Bearer test-api-key",
    "Content-Type": "application/json",
  };

  it("GET /api/projects returns empty list", async () => {
    const res = await app.request("/api/projects", { headers }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("POST /api/projects creates a project", async () => {
    const res = await app.request(
      "/api/projects",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "myapp",
          name: "My App",
          repo: "user/myapp",
        }),
      },
      env
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("myapp");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/anna/Documents/dabugs/worker && npx vitest run`
Expected: FAIL — modules not found

- [ ] **Step 4: Implement auth middleware**

File: `worker/src/middleware/auth.ts`

```typescript
import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

export const apiKeyAuth = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ error: "Missing Authorization header" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    if (token !== c.env.DABUGS_API_KEY) {
      return c.json({ error: "Invalid API key" }, 401);
    }

    await next();
  }
);
```

- [ ] **Step 5: Implement feedback routes**

File: `worker/src/routes/feedback.ts`

```typescript
import { Hono } from "hono";
import type { Env } from "../types";
import {
  insertFeedback,
  listFeedbacksByStatus,
  updateFeedbackDiagnosis,
  updateFeedbackStatus,
  getFeedbackById,
} from "../db/queries";

const feedback = new Hono<{ Bindings: Env }>();

feedback.get("/pending", async (c) => {
  const rows = await listFeedbacksByStatus(c.env.DB, "pending");
  return c.json(rows);
});

feedback.get("/confirmed", async (c) => {
  const rows = await listFeedbacksByStatus(c.env.DB, "confirmed");
  return c.json(rows);
});

feedback.post("/feedback", async (c) => {
  const body = await c.req.json<{
    project_id: string;
    source: "telegram" | "google_form";
    description: string;
    reporter_id?: string;
    reporter_name?: string;
    screenshot_urls?: string[];
  }>();

  if (!body.project_id || !body.description) {
    return c.json({ error: "project_id and description are required" }, 400);
  }

  const row = await insertFeedback(c.env.DB, {
    project_id: body.project_id,
    source: body.source ?? "telegram",
    description: body.description,
    reporter_id: body.reporter_id,
    reporter_name: body.reporter_name,
    screenshot_urls: body.screenshot_urls,
  });

  return c.json(row, 201);
});

feedback.patch("/feedback/:id/diagnose", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ diagnosis: string; fix_plan: string }>();

  if (!body.diagnosis || !body.fix_plan) {
    return c.json({ error: "diagnosis and fix_plan are required" }, 400);
  }

  const row = await updateFeedbackDiagnosis(c.env.DB, id, {
    diagnosis: body.diagnosis,
    fix_plan: body.fix_plan,
  });
  return c.json(row);
});

feedback.patch("/feedback/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ status: string; pr_url?: string }>();

  if (!body.status) {
    return c.json({ error: "status is required" }, 400);
  }

  const row = await updateFeedbackStatus(c.env.DB, id, {
    status: body.status as any,
    pr_url: body.pr_url,
  });
  return c.json(row);
});

export { feedback };
```

- [ ] **Step 6: Implement project routes**

File: `worker/src/routes/projects.ts`

```typescript
import { Hono } from "hono";
import type { Env } from "../types";
import { insertProject, listProjects } from "../db/queries";

const projects = new Hono<{ Bindings: Env }>();

projects.get("/projects", async (c) => {
  const rows = await listProjects(c.env.DB);
  return c.json(rows);
});

projects.post("/projects", async (c) => {
  const body = await c.req.json<{
    id: string;
    name: string;
    repo: string;
    description?: string;
  }>();

  if (!body.id || !body.name || !body.repo) {
    return c.json({ error: "id, name, and repo are required" }, 400);
  }

  const row = await insertProject(c.env.DB, {
    id: body.id,
    name: body.name,
    repo: body.repo,
    description: body.description,
  });
  return c.json(row, 201);
});

export { projects };
```

- [ ] **Step 7: Create the Hono app entry point**

File: `worker/src/index.ts`

```typescript
import { Hono } from "hono";
import type { Env } from "./types";
import { apiKeyAuth } from "./middleware/auth";
import { feedback } from "./routes/feedback";
import { projects } from "./routes/projects";

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.text("ok"));

app.use("/api/*", apiKeyAuth);
app.route("/api", feedback);
app.route("/api", projects);

export default {
  fetch: app.fetch,

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    // Task 5: Google Sheet polling
  },
};
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd /Users/anna/Documents/dabugs/worker && npx vitest run`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add worker/src/index.ts worker/src/middleware/auth.ts worker/src/routes/feedback.ts worker/src/routes/projects.ts worker/test/feedback.test.ts worker/test/projects.test.ts
git commit -m "feat: REST API routes for feedbacks and projects with auth middleware"
```

---

### Task 4: Telegram Bot (grammY Webhook)

**Files:**
- Create: `worker/src/services/telegram.ts`
- Modify: `worker/src/index.ts` — add telegram webhook route

- [ ] **Step 1: Implement Telegram service**

File: `worker/src/services/telegram.ts`

```typescript
import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import type { Env, FeedbackRow } from "../types";
import { insertFeedback, listProjects, updateFeedbackStatus } from "../db/queries";

export function createBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Welcome to DaBugs! I collect bug reports.\n\n" +
        "Commands:\n" +
        "/bug — Report a bug\n" +
        "/status — Check your recent reports"
    );
  });

  bot.command("bug", async (ctx) => {
    const projects = await listProjects(env.DB);

    if (projects.length === 0) {
      await ctx.reply("No projects configured yet. Ask the developer to add one.");
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const project of projects) {
      keyboard.text(project.name, `select_project:${project.id}`).row();
    }

    await ctx.reply("Select a project:", { reply_markup: keyboard });
  });

  bot.callbackQuery(/^select_project:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const projectId = ctx.match[1];

    await ctx.editMessageText(
      `Selected: ${projectId}\n\nPlease describe the bug:`
    );

    // Store project selection in a simple way: edit the message
    // The next text message from this user will be the bug description
    // We use a convention: store pending project in callback data
    // This is handled by the text handler below
  });

  bot.callbackQuery(/^confirm:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Confirmed! Fix in progress..." });
    const feedbackId = Number(ctx.match[1]);

    await updateFeedbackStatus(env.DB, feedbackId, { status: "confirmed" });
    await ctx.editMessageText(
      ctx.callbackQuery.message?.text + "\n\n✅ Confirmed — fix in progress"
    );
  });

  bot.callbackQuery(/^reject:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Rejected." });
    const feedbackId = Number(ctx.match[1]);

    await updateFeedbackStatus(env.DB, feedbackId, { status: "rejected" });
    await ctx.editMessageText(
      ctx.callbackQuery.message?.text + "\n\n❌ Rejected"
    );
  });

  bot.on("message:text", async (ctx) => {
    // Treat any plain text as a bug report
    // User needs to have selected a project first via /bug
    // For simplicity in V1: if only one project exists, auto-select it
    const projects = await listProjects(env.DB);

    if (projects.length === 0) {
      await ctx.reply("No projects configured. Use /bug after the developer adds a project.");
      return;
    }

    // V1 simplification: use first project if only one, otherwise ask
    if (projects.length > 1) {
      await ctx.reply("Please use /bug to select a project first.");
      return;
    }

    const project = projects[0];
    const feedback = await insertFeedback(env.DB, {
      project_id: project.id,
      source: "telegram",
      description: ctx.message.text,
      reporter_id: String(ctx.from.id),
      reporter_name: ctx.from.username ?? ctx.from.first_name,
    });

    await ctx.reply(
      `✅ Bug #${feedback.id} recorded [${project.name}]. We'll look into it!`
    );

    await notifyAdmin(env, feedback, project.name);
  });

  bot.on("message:photo", async (ctx) => {
    const projects = await listProjects(env.DB);
    if (projects.length === 0) return;

    const project = projects.length === 1 ? projects[0] : null;
    if (!project) {
      await ctx.reply("Please use /bug to select a project first.");
      return;
    }

    const caption = ctx.message.caption ?? "Screenshot bug report";
    const photos = ctx.message.photo;
    const fileId = photos[photos.length - 1].file_id;

    const feedback = await insertFeedback(env.DB, {
      project_id: project.id,
      source: "telegram",
      description: caption,
      reporter_id: String(ctx.from.id),
      reporter_name: ctx.from.username ?? ctx.from.first_name,
      screenshot_urls: [fileId],
    });

    await ctx.reply(
      `✅ Bug #${feedback.id} recorded with screenshot [${project.name}]. We'll look into it!`
    );

    await notifyAdmin(env, feedback, project.name);
  });

  return bot;
}

async function notifyAdmin(
  env: Env,
  feedback: FeedbackRow,
  projectName: string
): Promise<void> {
  const chatId = env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) return;

  const bot = new Bot(env.BOT_TOKEN);
  const text =
    `🐛 New Bug #${feedback.id} [${projectName}]\n\n` +
    `From: ${feedback.reporter_name}\n` +
    `Description: ${feedback.description}`;

  await bot.api.sendMessage(Number(chatId), text);
}

export async function sendDiagnosisNotification(
  env: Env,
  feedback: FeedbackRow,
  projectName: string
): Promise<void> {
  const chatId = env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) return;

  const bot = new Bot(env.BOT_TOKEN);
  const keyboard = new InlineKeyboard()
    .text("✅ Confirm Fix", `confirm:${feedback.id}`)
    .text("❌ Reject", `reject:${feedback.id}`);

  const text =
    `🔍 Bug #${feedback.id} Diagnosis [${projectName}]\n\n` +
    `Problem: ${feedback.diagnosis}\n\n` +
    `Fix Plan: ${feedback.fix_plan}`;

  await bot.api.sendMessage(Number(chatId), text, {
    reply_markup: keyboard,
  });
}

export async function sendFixedNotification(
  env: Env,
  feedback: FeedbackRow,
  projectName: string
): Promise<void> {
  const chatId = env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) return;

  const bot = new Bot(env.BOT_TOKEN);

  // Notify developer
  await bot.api.sendMessage(
    Number(chatId),
    `✅ Bug #${feedback.id} fixed! [${projectName}]\nPR: ${feedback.pr_url}`
  );

  // Notify reporter
  if (feedback.reporter_id) {
    await bot.api.sendMessage(
      Number(feedback.reporter_id),
      `🎉 Your bug #${feedback.id} has been fixed. Thank you!`
    );
  }
}

export function createWebhookHandler(env: Env) {
  const bot = createBot(env);
  return webhookCallback(bot, "cloudflare-mod");
}
```

- [ ] **Step 2: Add webhook route to index.ts**

Update `worker/src/index.ts` — add before the `app.use("/api/*", apiKeyAuth)` line:

```typescript
import { createWebhookHandler } from "./services/telegram";

// ... existing code ...

// Telegram webhook (uses its own auth via secret)
app.post("/api/telegram/webhook", async (c) => {
  const secret = c.req.query("secret");
  if (secret !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: "Invalid webhook secret" }, 401);
  }
  const handler = createWebhookHandler(c.env);
  return handler(c.req.raw);
});
```

Move this route BEFORE the `app.use("/api/*", apiKeyAuth)` middleware so it uses its own auth.

The full updated `worker/src/index.ts`:

```typescript
import { Hono } from "hono";
import type { Env } from "./types";
import { apiKeyAuth } from "./middleware/auth";
import { feedback } from "./routes/feedback";
import { projects } from "./routes/projects";
import { createWebhookHandler } from "./services/telegram";

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.text("ok"));

// Telegram webhook (own auth via secret param)
app.post("/api/telegram/webhook", async (c) => {
  const secret = c.req.query("secret");
  if (secret !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: "Invalid webhook secret" }, 401);
  }
  const handler = createWebhookHandler(c.env);
  return handler(c.req.raw);
});

// API routes (API key auth)
app.use("/api/*", apiKeyAuth);
app.route("/api", feedback);
app.route("/api", projects);

export default {
  fetch: app.fetch,

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    // Task 5: Google Sheet polling
  },
};
```

- [ ] **Step 3: Verify build compiles**

Run: `cd /Users/anna/Documents/dabugs/worker && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run all tests**

Run: `cd /Users/anna/Documents/dabugs/worker && npx vitest run`
Expected: All existing tests still PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/services/telegram.ts worker/src/index.ts
git commit -m "feat: Telegram bot with grammY webhook, inline keyboards, and admin notifications"
```

---

### Task 5: Google Sheet Poller + Cron Trigger

**Files:**
- Create: `worker/src/services/google-sheet.ts`
- Modify: `worker/src/index.ts` — implement scheduled handler

- [ ] **Step 1: Implement Google Sheet service**

File: `worker/src/services/google-sheet.ts`

```typescript
import type { Env } from "../types";
import {
  insertFeedback,
  getGoogleSheetCursor,
  setGoogleSheetCursor,
  listProjects,
} from "../db/queries";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n|\r/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const claims = btoa(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    })
  );

  const signInput = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signInput)
  );

  const sig64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  const jwt = `${signInput}.${sig64}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function readSheetRows(
  sheetId: string,
  range: string,
  token: string
): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Google Sheets API error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { values?: string[][] };
  return data.values ?? [];
}

export async function pollGoogleSheet(env: Env): Promise<number> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_KEY || !env.GOOGLE_SHEET_ID) {
    return 0;
  }

  const sa: ServiceAccountKey = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const token = await getAccessToken(sa);

  const lastRow = await getGoogleSheetCursor(env.DB);

  // Expected columns: A=Project, B=Description, C=Email, D=Screenshot URL
  const range = `Sheet1!A${lastRow + 1}:D1000`;
  const rows = await readSheetRows(env.GOOGLE_SHEET_ID, range, token);

  if (rows.length === 0) return 0;

  const projects = await listProjects(env.DB);
  const projectIds = new Set(projects.map((p) => p.id));

  let imported = 0;
  for (const row of rows) {
    const [projectId, description, email, screenshotUrl] = row;

    if (!projectId || !description) continue;
    if (!projectIds.has(projectId)) continue;

    const screenshots = screenshotUrl ? [screenshotUrl] : [];

    await insertFeedback(env.DB, {
      project_id: projectId,
      source: "google_form",
      description,
      reporter_id: email ?? "",
      reporter_name: email ?? "",
      screenshot_urls: screenshots,
    });
    imported++;
  }

  await setGoogleSheetCursor(env.DB, lastRow + rows.length);
  return imported;
}
```

- [ ] **Step 2: Wire up scheduled handler in index.ts**

Update the `scheduled` method in `worker/src/index.ts`:

```typescript
import { pollGoogleSheet } from "./services/google-sheet";

// ... in the export default block:
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const imported = await pollGoogleSheet(env);
          if (imported > 0) {
            console.log(`Imported ${imported} feedbacks from Google Sheet`);
          }
        } catch (err) {
          console.error("Google Sheet poll failed:", err);
        }
      })()
    );
  },
```

- [ ] **Step 3: Verify build compiles**

Run: `cd /Users/anna/Documents/dabugs/worker && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run all tests**

Run: `cd /Users/anna/Documents/dabugs/worker && npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add worker/src/services/google-sheet.ts worker/src/index.ts
git commit -m "feat: Google Sheet poller with JWT auth and cron trigger"
```

---

### Task 6: Auto-Notify on Diagnosis (Wire Telegram to API)

**Files:**
- Modify: `worker/src/routes/feedback.ts` — send Telegram notification after diagnosis

- [ ] **Step 1: Update diagnose route to send Telegram notification**

In `worker/src/routes/feedback.ts`, update the diagnose handler to also send the notification:

```typescript
import { sendDiagnosisNotification, sendFixedNotification } from "../services/telegram";
import { listProjects } from "../db/queries";

// Replace the existing diagnose handler:
feedback.patch("/feedback/:id/diagnose", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ diagnosis: string; fix_plan: string }>();

  if (!body.diagnosis || !body.fix_plan) {
    return c.json({ error: "diagnosis and fix_plan are required" }, 400);
  }

  const row = await updateFeedbackDiagnosis(c.env.DB, id, {
    diagnosis: body.diagnosis,
    fix_plan: body.fix_plan,
  });

  // Send Telegram notification to developer
  const projects = await listProjects(c.env.DB);
  const project = projects.find((p) => p.id === row.project_id);
  if (project) {
    await sendDiagnosisNotification(c.env, row, project.name);
  }

  return c.json(row);
});

// Replace the existing status handler:
feedback.patch("/feedback/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ status: string; pr_url?: string }>();

  if (!body.status) {
    return c.json({ error: "status is required" }, 400);
  }

  const row = await updateFeedbackStatus(c.env.DB, id, {
    status: body.status as any,
    pr_url: body.pr_url,
  });

  // Notify on fixed status
  if (body.status === "fixed" && body.pr_url) {
    const projects = await listProjects(c.env.DB);
    const project = projects.find((p) => p.id === row.project_id);
    if (project) {
      await sendFixedNotification(c.env, row, project.name);
    }
  }

  return c.json(row);
});
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/anna/Documents/dabugs/worker && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add worker/src/routes/feedback.ts
git commit -m "feat: auto-send Telegram notifications on diagnosis and fix completion"
```

---

### Task 7: Claude Code Skill

**Files:**
- Create: `skill/dabugs.md`

- [ ] **Step 1: Write the skill definition**

File: `skill/dabugs.md`

````markdown
---
name: dabugs
description: Process bug feedbacks — diagnose pending bugs and implement confirmed fixes
---

# DaBugs — Bug Feedback Processor

You are a bug diagnosis and fix agent. You process user-reported bugs by analyzing codebases, diagnosing issues, and creating pull requests for confirmed fixes.

## Configuration

Read your config from `~/.dabugs/projects.json`:

```json
{
  "api_url": "https://dabugs.xxx.workers.dev",
  "api_key": "dbg_xxxxxxxxxxxx",
  "projects": {
    "project-id": {
      "name": "Project Name",
      "repo": "owner/repo",
      "local_path": "/absolute/path/to/project"
    }
  }
}
```

## Workflow

### Phase 1: Diagnose Pending Feedbacks

1. Read `~/.dabugs/projects.json` to get API URL and key
2. Fetch pending feedbacks:
   ```bash
   curl -s "$API_URL/api/pending" -H "Authorization: Bearer $API_KEY"
   ```
3. If empty array `[]` → print "No pending feedbacks" and move to Phase 2
4. For each pending feedback:
   a. Update status to `diagnosing`:
      ```bash
      curl -s -X PATCH "$API_URL/api/feedback/$ID/status" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"status": "diagnosing"}'
      ```
   b. Look up `project_id` in projects.json to find `local_path`
   c. Read the project's source code at that path. Search for keywords from the bug description using Grep and Read tools
   d. Analyze the code to find the root cause
   e. If you can identify the issue:
      - Write a clear diagnosis (what's wrong and why)
      - Write a specific fix plan (which files to change and how)
      - Submit:
        ```bash
        curl -s -X PATCH "$API_URL/api/feedback/$ID/diagnose" \
          -H "Authorization: Bearer $API_KEY" \
          -H "Content-Type: application/json" \
          -d '{"diagnosis": "...", "fix_plan": "..."}'
        ```
   f. If you CANNOT identify the issue:
      - Update status to `needs_review`:
        ```bash
        curl -s -X PATCH "$API_URL/api/feedback/$ID/status" \
          -H "Authorization: Bearer $API_KEY" \
          -H "Content-Type: application/json" \
          -d '{"status": "needs_review"}'
        ```

### Phase 2: Fix Confirmed Feedbacks

1. Fetch confirmed feedbacks:
   ```bash
   curl -s "$API_URL/api/confirmed" -H "Authorization: Bearer $API_KEY"
   ```
2. If empty → print "No confirmed feedbacks" and exit
3. For each confirmed feedback:
   a. Update status to `fixing`:
      ```bash
      curl -s -X PATCH "$API_URL/api/feedback/$ID/status" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"status": "fixing"}'
      ```
   b. `cd` to the project's `local_path`
   c. Ensure main branch is up to date: `git checkout main && git pull`
   d. Create fix branch: `git checkout -b fix/dabugs-$ID`
   e. Implement the fix described in `fix_plan`
   f. Run the project's tests if a test command exists
   g. If tests pass:
      - `git add` changed files
      - `git commit -m "fix: resolve bug #$ID — $SHORT_DESCRIPTION"`
      - `git push -u origin fix/dabugs-$ID`
      - Create PR: `gh pr create --title "fix: bug #$ID" --body "Resolves DaBugs feedback #$ID\n\n$DIAGNOSIS\n\n$FIX_PLAN"`
      - Capture the PR URL from gh output
      - Update status to `fixed`:
        ```bash
        curl -s -X PATCH "$API_URL/api/feedback/$ID/status" \
          -H "Authorization: Bearer $API_KEY" \
          -H "Content-Type: application/json" \
          -d '{"status": "fixed", "pr_url": "$PR_URL"}'
        ```
   h. If tests fail:
      - `git checkout main` and `git branch -D fix/dabugs-$ID`
      - Update status back to `diagnosed`:
        ```bash
        curl -s -X PATCH "$API_URL/api/feedback/$ID/status" \
          -H "Authorization: Bearer $API_KEY" \
          -H "Content-Type: application/json" \
          -d '{"status": "diagnosed"}'
        ```
      - Print warning: "Fix for bug #$ID failed tests — reverted"

## Rules

- NEVER push to main directly — always create a branch and PR
- One PR per feedback — do not batch multiple fixes
- If you are not confident about the diagnosis, mark as `needs_review`
- Keep fixes minimal — only change what is necessary for the bug
- Do not refactor surrounding code
- Always check for the project in projects.json before processing
- If a project's local_path doesn't exist, skip that feedback
````

- [ ] **Step 2: Commit**

```bash
git add skill/dabugs.md
git commit -m "feat: Claude Code skill for diagnosing and fixing bugs via /loop"
```

---

### Task 8: CLI Tool

**Files:**
- Create: `cli/package.json`
- Create: `cli/tsconfig.json`
- Create: `cli/src/config.ts`
- Create: `cli/src/init.ts`
- Create: `cli/src/add-project.ts`
- Create: `cli/src/index.ts`
- Create: `cli/test/config.test.ts`

- [ ] **Step 1: Create cli/package.json**

```json
{
  "name": "dabugs",
  "version": "0.1.0",
  "description": "AI-powered bug feedback loop — users report, AI fixes",
  "type": "module",
  "bin": {
    "dabugs": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "commander": "^13.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  },
  "keywords": ["telegram", "bug-tracking", "ai", "claude-code", "cloudflare-workers"],
  "license": "MIT"
}
```

- [ ] **Step 2: Create cli/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ESNext"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write failing test for config module**

File: `cli/test/config.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readConfig, writeConfig, getConfigPath } from "../src/config";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("config", () => {
  const testDir = join(tmpdir(), "dabugs-test-" + Date.now());
  const originalHome = process.env.HOME;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env.DABUGS_CONFIG_DIR = testDir;
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.DABUGS_CONFIG_DIR;
  });

  it("returns default config when file does not exist", () => {
    const config = readConfig();
    expect(config.api_url).toBe("");
    expect(config.api_key).toBe("");
    expect(config.projects).toEqual({});
  });

  it("writes and reads config", () => {
    const config = {
      api_url: "https://dabugs.test.workers.dev",
      api_key: "dbg_test123",
      projects: {
        myapp: {
          name: "My App",
          repo: "user/myapp",
          local_path: "/home/user/myapp",
        },
      },
    };

    writeConfig(config);
    const loaded = readConfig();
    expect(loaded).toEqual(config);
  });

  it("adds a project to existing config", () => {
    writeConfig({
      api_url: "https://test.workers.dev",
      api_key: "dbg_test",
      projects: {},
    });

    const config = readConfig();
    const updated = {
      ...config,
      projects: {
        ...config.projects,
        newproj: {
          name: "New Project",
          repo: "user/newproj",
          local_path: "/home/user/newproj",
        },
      },
    };
    writeConfig(updated);

    const reloaded = readConfig();
    expect(reloaded.projects.newproj.name).toBe("New Project");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd /Users/anna/Documents/dabugs/cli && npm install && npx vitest run`
Expected: FAIL — module not found

- [ ] **Step 5: Implement config module**

File: `cli/src/config.ts`

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ProjectConfig {
  name: string;
  repo: string;
  local_path: string;
}

export interface DabugsConfig {
  api_url: string;
  api_key: string;
  projects: Record<string, ProjectConfig>;
}

export function getConfigDir(): string {
  return process.env.DABUGS_CONFIG_DIR ?? join(homedir(), ".dabugs");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "projects.json");
}

export function readConfig(): DabugsConfig {
  const path = getConfigPath();
  if (!existsSync(path)) {
    return { api_url: "", api_key: "", projects: {} };
  }
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as DabugsConfig;
}

export function writeConfig(config: DabugsConfig): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n");
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/anna/Documents/dabugs/cli && npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Implement init command**

File: `cli/src/init.ts`

```typescript
import { readConfig, writeConfig, getConfigDir } from "./config";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function initCommand(): Promise<void> {
  console.log("🐛 DaBugs Setup\n");

  const existing = readConfig();
  if (existing.api_url) {
    console.log(`Config already exists at ${getConfigDir()}`);
    const overwrite = await prompt("Overwrite? (y/N): ");
    if (overwrite.toLowerCase() !== "y") {
      console.log("Aborted.");
      return;
    }
  }

  const apiUrl = await prompt("Worker URL (e.g. https://dabugs.you.workers.dev): ");
  const apiKey = await prompt("API Key: ");

  const config = { api_url: apiUrl, api_key: apiKey, projects: {} };
  writeConfig(config);

  console.log(`\n✅ Config saved to ${getConfigDir()}/projects.json`);

  // Install skill
  const skillSource = join(process.cwd(), "skill", "dabugs.md");
  const skillDest = join(homedir(), ".claude", "skills", "dabugs.md");

  if (existsSync(skillSource)) {
    const skillDir = join(homedir(), ".claude", "skills");
    mkdirSync(skillDir, { recursive: true });
    copyFileSync(skillSource, skillDest);
    console.log(`✅ Skill installed to ${skillDest}`);
  } else {
    console.log("⚠️  Skill file not found. Copy skill/dabugs.md to ~/.claude/skills/ manually.");
  }

  console.log("\nNext steps:");
  console.log('  dabugs add-project <id> --repo <owner/repo> --path <local-path>');
  console.log('  claude "/loop 5m /dabugs"');
}
```

- [ ] **Step 8: Implement add-project command**

File: `cli/src/add-project.ts`

```typescript
import { readConfig, writeConfig } from "./config";

interface AddProjectOptions {
  repo: string;
  path: string;
  name?: string;
}

export function addProjectCommand(id: string, options: AddProjectOptions): void {
  const config = readConfig();

  if (!config.api_url) {
    console.error("❌ Run `dabugs init` first.");
    process.exit(1);
  }

  if (config.projects[id]) {
    console.error(`❌ Project "${id}" already exists. Remove it first or use a different ID.`);
    process.exit(1);
  }

  const updatedProjects = {
    ...config.projects,
    [id]: {
      name: options.name ?? id,
      repo: options.repo,
      local_path: options.path,
    },
  };

  writeConfig({ ...config, projects: updatedProjects });

  console.log(`✅ Project "${id}" added.`);
  console.log(`   Repo: ${options.repo}`);
  console.log(`   Path: ${options.path}`);

  // Register project on the worker
  console.log("\nRegistering on remote worker...");
  registerRemoteProject(config.api_url, config.api_key, {
    id,
    name: options.name ?? id,
    repo: options.repo,
  }).then(() => {
    console.log("✅ Registered on worker.");
  }).catch((err) => {
    console.error(`⚠️  Failed to register remotely: ${err.message}`);
    console.log("   You can register manually via the API later.");
  });
}

async function registerRemoteProject(
  apiUrl: string,
  apiKey: string,
  project: { id: string; name: string; repo: string }
): Promise<void> {
  const res = await fetch(`${apiUrl}/api/projects`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(project),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
}
```

- [ ] **Step 9: Implement CLI entry point**

File: `cli/src/index.ts`

```typescript
#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./init.js";
import { addProjectCommand } from "./add-project.js";

const program = new Command();

program
  .name("dabugs")
  .description("AI-powered bug feedback loop")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize DaBugs configuration and install Claude Code skill")
  .action(async () => {
    await initCommand();
  });

program
  .command("add-project <id>")
  .description("Add a project to track")
  .requiredOption("--repo <owner/repo>", "GitHub repository")
  .requiredOption("--path <local-path>", "Local project path")
  .option("--name <display-name>", "Display name (defaults to id)")
  .action((id, options) => {
    addProjectCommand(id, options);
  });

program.parse();
```

- [ ] **Step 10: Install CLI dependencies and run tests**

Run: `cd /Users/anna/Documents/dabugs/cli && npm install && npx vitest run`
Expected: All tests PASS

- [ ] **Step 11: Commit**

```bash
git add cli/
git commit -m "feat: CLI tool for init, config management, and project registration"
```

---

### Task 9: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

File: `README.md`

````markdown
# DaBugs

> Users report bugs → AI diagnoses & fixes → PR created automatically

DaBugs is an open-source tool that creates a closed-loop bug fixing workflow for indie developers. Users submit bug reports through Telegram or Google Form; Claude Code automatically diagnoses the issue, proposes a fix, and — after your confirmation — creates a pull request.

## How It Works

```
User reports bug → Cloudflare Worker stores it → Claude Code /loop picks it up
→ AI analyzes your codebase → Sends diagnosis to your Telegram
→ You confirm → AI creates fix PR → User notified
```

## Quick Start

### 1. Deploy the Worker

```bash
cd worker
npm install
npx wrangler d1 create dabugs-db        # Create D1 database
# Update wrangler.toml with the database_id from above
npx wrangler d1 execute dabugs-db --remote --file=src/db/schema.sql
npx wrangler secret put DABUGS_API_KEY   # Your API key
npx wrangler secret put BOT_TOKEN        # Telegram bot token from @BotFather
npx wrangler secret put TELEGRAM_ADMIN_CHAT_ID  # Your Telegram chat ID
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET # Random string for webhook auth
npx wrangler deploy
```

### 2. Set Telegram Webhook

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://dabugs.<you>.workers.dev/api/telegram/webhook?secret=<WEBHOOK_SECRET>"
```

### 3. Install CLI & Configure

```bash
cd cli && npm install -g .
dabugs init
dabugs add-project myapp --repo user/myapp --path /path/to/myapp
```

### 4. Start the Loop

```bash
claude "/loop 5m /dabugs"
```

### 5. (Optional) Google Form

- Create a Google Form with: Project (dropdown), Description (text), Screenshot (file upload)
- Link responses to a Google Sheet
- Create a Service Account, share the Sheet with it
- Set worker secrets:
  ```bash
  npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_KEY  # Paste the full JSON key
  npx wrangler secret put GOOGLE_SHEET_ID              # Sheet ID from URL
  ```

## Architecture

| Component | Technology | Free Tier |
|-----------|-----------|-----------|
| Server | Cloudflare Worker | 100k req/day |
| Database | Cloudflare D1 | 5GB |
| Bot | grammY on Workers | - |
| AI Agent | Claude Code skill | - |
| CLI | TypeScript / npm | - |

## Feedback Lifecycle

```
pending → diagnosing → diagnosed → confirmed → fixing → fixed
                                       ↓
                                   rejected
```

## API

All endpoints require `Authorization: Bearer <API_KEY>` header.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/pending` | List pending feedbacks |
| GET | `/api/confirmed` | List confirmed feedbacks |
| POST | `/api/feedback` | Create feedback |
| PATCH | `/api/feedback/:id/diagnose` | Submit diagnosis |
| PATCH | `/api/feedback/:id/status` | Update status |
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Register project |

## License

MIT
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup guide and architecture overview"
```

---

### Task 10: End-to-End Verification

- [ ] **Step 1: Run all worker tests**

Run: `cd /Users/anna/Documents/dabugs/worker && npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run CLI tests**

Run: `cd /Users/anna/Documents/dabugs/cli && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Type-check everything**

Run: `cd /Users/anna/Documents/dabugs/worker && npx tsc --noEmit && cd ../cli && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Verify local dev works**

Run: `cd /Users/anna/Documents/dabugs/worker && npx wrangler dev --local`
Expected: Worker starts on localhost, `/healthz` returns "ok"

- [ ] **Step 5: Create GitHub repo and push**

```bash
cd /Users/anna/Documents/dabugs
gh repo create tonypk/dabugs --public --description "AI-powered bug feedback loop — users report, AI fixes" --source=. --push
```
