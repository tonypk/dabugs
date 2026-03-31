# DaBugs — AI-Powered Bug Feedback Loop

> Users report bugs → AI diagnoses & fixes → PR created automatically

**Date**: 2026-03-31
**Status**: Approved
**License**: MIT (Open Source)

---

## 1. Overview

DaBugs is an open-source tool that creates a closed-loop bug fixing workflow for indie developers. Users submit bug reports through Telegram or Google Form; an AI agent (Claude Code) automatically diagnoses the issue, proposes a fix, and — after developer confirmation — creates a pull request.

### Target User

Solo developers managing one or more projects who want to automate the feedback-to-fix pipeline.

### Core Principle

**Human-in-the-loop**: AI proposes fixes, but the developer must confirm before any code changes are made.

---

## 2. Architecture

```
┌─────────────┐     ┌──────────────────────────────────┐
│  Telegram    │────▶│  Cloudflare Worker               │
│  Users       │     │  ┌────────────────────────────┐  │
│              │     │  │  /api/telegram  (webhook)   │  │
│  Google      │     │  │  /api/feedback  (REST API)  │  │
│  Form        │─────│  │  cron: poll Google Sheet    │  │
│  (Sheet)     │     │  └──────────┬─────────────────┘  │
└──────────────┘     │             │                     │
                     │        Cloudflare D1              │
                     │        (SQLite)                   │
                     └──────────┬────────────────────────┘
                                │
                      HTTP API (REST)
                                │
                     ┌──────────▼────────────────────┐
                     │  Claude Code (local)           │
                     │  /loop 5m /dabugs              │
                     │                                │
                     │  1. GET /api/pending            │
                     │  2. Analyze code → diagnose     │
                     │  3. PATCH /api/diagnose         │
                     │  4. Telegram notifies developer │
                     │  5. Developer confirms → fix+PR │
                     └────────────────────────────────┘
```

### Technology Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Server | Cloudflare Worker (TypeScript) | Free tier, zero ops, global edge |
| Database | Cloudflare D1 (SQLite) | Zero config, free 5GB |
| Telegram Bot | grammY (TS) | Mature, Worker-compatible |
| Google Sheet | Google Sheets API v4 | Service Account, read-only |
| Scheduled Polls | Cloudflare Cron Triggers | Free, reliable |
| AI Agent | Claude Code custom skill | Native code analysis + git ops |
| CLI | TypeScript (npm package) | Setup + project management |

### Deployment

All server components deploy to Cloudflare (free tier):
- Workers: 100k requests/day free
- D1: 5GB free
- Cron Triggers: free

---

## 3. Multi-Project Support

One bot and one Google Form serve all projects. Users select a project when submitting.

### Telegram Interaction

```
User: /bug
Bot:  Select a project 👇
      [MakeMyHotel] [OpenToke] [AIGoNHR]
User: (taps MakeMyHotel)
Bot:  Describe the bug:
User: Login page submit button does nothing
Bot:  ✅ Bug #42 recorded [MakeMyHotel]. We'll look into it!
```

### Google Form

- Dropdown field: Project selection
- Text field: Bug description
- File upload: Screenshots (optional) — stored as Google Drive links in the Sheet, saved to `screenshot_urls` JSON array in D1
- Cron Trigger polls Sheet every 5 minutes, tracks last processed row to avoid duplicates

### Local Project Mapping

```json
// ~/.dabugs/projects.json
{
  "api_url": "https://dabugs.xxx.workers.dev",
  "api_key": "dbg_xxxxxxxxxxxx",
  "projects": {
    "makemyhotel": {
      "name": "MakeMyHotel",
      "repo": "tonypk/makemyhotel",
      "local_path": "/Users/anna/Documents/makemyhotel"
    }
  }
}
```

### Claude Code Loop

A single `/loop 5m /dabugs` handles all projects. The skill reads `projects.json` to map `project_id` → local directory, then operates on the correct repo.

---

## 4. Feedback Lifecycle

```
pending → diagnosing → diagnosed → confirmed → fixing → fixed
                                       ↓
                                   rejected
```

| Status | Triggered By | Description |
|--------|-------------|-------------|
| `pending` | User submits | New feedback, awaiting AI |
| `diagnosing` | Skill picks up | AI analyzing (prevents duplicate processing) |
| `diagnosed` | Skill completes | AI diagnosis + fix plan ready, awaiting developer |
| `confirmed` | Developer taps ✅ | Developer approves the fix plan |
| `fixing` | Skill starts fix | AI implementing the fix |
| `fixed` | Skill creates PR | PR created, link attached |
| `rejected` | Developer taps ❌ | Won't fix / false positive |
| `needs_review` | Skill can't diagnose | AI unsure, needs human review |

### Telegram Notification Flow

```
🤖 → Developer:
   🔍 Bug #42 Diagnosis [MakeMyHotel]

   Problem: Login form submit handler missing await,
   API call returns before form clears

   📁 frontend/src/views/LoginView.vue:45
   Fix: Add async/await to handleSubmit()

   [✅ Confirm Fix]  [❌ Reject]  [💬 Ask More]

--- Developer taps Confirm ---

🤖 → Developer:
   🔧 Fixing Bug #42...

--- Fix complete ---

🤖 → Developer:
   ✅ Bug #42 fixed!
   PR: https://github.com/tonypk/makemyhotel/pull/87

🤖 → User:
   🎉 Your bug #42 has been fixed. Thank you!
```

---

## 5. Data Model

### D1 Schema

```sql
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repo TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE feedbacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    source TEXT NOT NULL,               -- "telegram" | "google_form"
    status TEXT NOT NULL DEFAULT 'pending',
    description TEXT NOT NULL,
    screenshot_urls TEXT DEFAULT '[]',   -- JSON array
    reporter_id TEXT DEFAULT '',         -- telegram user id or form email
    reporter_name TEXT DEFAULT '',
    diagnosis TEXT DEFAULT '',
    fix_plan TEXT DEFAULT '',
    pr_url TEXT DEFAULT '',
    retry_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_feedbacks_status ON feedbacks(status);
CREATE INDEX idx_feedbacks_project ON feedbacks(project_id);
```

---

## 6. Worker REST API

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/pending` | List all pending feedbacks | API Key |
| GET | `/api/confirmed` | List all confirmed feedbacks | API Key |
| POST | `/api/feedback` | Create feedback (generic) | API Key |
| PATCH | `/api/feedback/:id/diagnose` | Submit diagnosis + fix plan | API Key |
| PATCH | `/api/feedback/:id/status` | Update status | API Key |
| GET | `/api/projects` | List projects | API Key |
| POST | `/api/projects` | Register a project | API Key |
| POST | `/api/telegram/webhook` | Telegram webhook entry | Telegram Secret |

### Authentication

- REST API: `Authorization: Bearer <DABUGS_API_KEY>` header
- Telegram webhook: Verified via secret_token parameter
- API Key stored in Cloudflare Worker environment variables

---

## 7. Claude Code Skill

### Skill File: `~/.claude/skills/dabugs.md`

The skill is invoked by `/loop 5m /dabugs` and performs:

1. **Fetch pending feedbacks** — `GET /api/pending`
2. **No feedbacks?** — Exit silently
3. **For each pending feedback:**
   - Update status → `diagnosing`
   - Look up project local path from `~/.dabugs/projects.json`
   - Read relevant source files, grep for keywords from description
   - Generate diagnosis (root cause) and fix plan (specific files + changes)
   - Submit via `PATCH /api/feedback/:id/diagnose`
   - Worker auto-sends Telegram notification to developer
4. **Fetch confirmed feedbacks** — `GET /api/confirmed`
5. **For each confirmed feedback:**
   - Update status → `fixing`
   - `cd` to project directory
   - `git checkout -b fix/dabugs-{id}`
   - Implement the fix
   - `git commit && git push && gh pr create`
   - Update status → `fixed` with PR URL
   - Worker notifies user + developer

### Skill Rules

- Never push to main directly — always branch + PR
- One PR per feedback
- If diagnosis confidence is low → mark `needs_review`, don't guess
- Keep fixes minimal — only change what's necessary
- Max 3 retry attempts per feedback before marking `needs_review`

---

## 8. Error Handling

### Diagnosis Failure

- AI cannot locate the issue → status = `needs_review`
- Telegram notification: "AI couldn't diagnose this automatically, please review manually"
- `retry_count` incremented; after 3 failures → auto `needs_review`

### Fix Failure

- Tests fail after changes → rollback branch, status back to `diagnosed`
- Push/PR creation fails → preserve local branch, notify developer
- Telegram: "Fix attempt failed, local branch `fix/dabugs-42` preserved"

### Network Errors

- Worker API unreachable → skill retries next loop cycle (5 min)
- Telegram API down → log error, feedback remains in current status

---

## 9. Security

- **API Key auth** — stored in Cloudflare env vars, never in code
- **Telegram webhook secret** — validates incoming requests are from Telegram
- **Human-in-the-loop** — AI never modifies code without developer confirmation
- **Branch isolation** — all fixes on separate branches, never direct to main
- **Google Sheet** — Service Account with read-only access
- **Rate limiting** — 10 feedbacks per user per project per hour (anti-spam)

---

## 10. Project Structure

```
dabugs/
├── worker/                     # Cloudflare Worker
│   ├── src/
│   │   ├── index.ts            # Router entry point
│   │   ├── routes/
│   │   │   ├── telegram.ts     # Telegram webhook handler
│   │   │   ├── feedback.ts     # Feedback REST API
│   │   │   └── projects.ts     # Project management API
│   │   ├── services/
│   │   │   ├── google-sheet.ts # Google Sheet poller
│   │   │   └── telegram.ts     # Telegram message sender
│   │   ├── db/
│   │   │   ├── schema.sql      # D1 schema
│   │   │   └── queries.ts      # Database operations
│   │   └── types.ts            # Type definitions
│   ├── wrangler.toml
│   ├── package.json
│   └── tsconfig.json
├── cli/                        # dabugs CLI (npm package)
│   ├── src/
│   │   ├── index.ts            # CLI entry point
│   │   ├── init.ts             # dabugs init
│   │   └── add-project.ts      # dabugs add-project
│   └── package.json
├── skill/
│   └── dabugs.md               # Claude Code custom skill
├── docs/
│   ├── setup.md                # Deployment guide
│   └── how-it-works.md         # Architecture explanation
├── README.md
└── LICENSE                     # MIT
```

---

## 11. User Setup Flow

```bash
# 1. Install CLI
npm install -g dabugs

# 2. Initialize (creates config + deploys worker)
dabugs init
# → Creates ~/.dabugs/projects.json
# → Deploys Cloudflare Worker (requires wrangler login)
# → Sets up D1 database
# → Prompts for Telegram bot token + Google service account

# 3. Add projects
dabugs add-project makemyhotel \
  --repo tonypk/makemyhotel \
  --path /Users/anna/Documents/makemyhotel

# 4. Start the loop
claude "/loop 5m /dabugs"
```

---

## 12. Out of Scope (V1)

- Web dashboard for managing feedbacks
- Multiple developers / team support
- Auto-merge (always needs human review)
- Custom AI models (Claude Code only)
- Self-hosted alternative to Cloudflare
