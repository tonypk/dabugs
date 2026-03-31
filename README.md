# DaBugs

> Users report bugs → AI diagnoses & fixes → PR created automatically

DaBugs is an open-source tool that automates the entire bug feedback loop for solo developers. Users submit bug reports through a **Telegram bot** or **Google Form**; **Claude Code** automatically diagnoses the issue, proposes a fix, and — after your one-tap confirmation — creates a pull request. Zero manual triage. Zero context switching.

## Why DaBugs?

As a solo developer, your users find bugs faster than you can fix them. Every bug report means: stop what you're doing → read the report → grep through code → diagnose → fix → branch → PR → back to what you were doing. Repeat 10x a day.

DaBugs turns this into: **user reports bug → you tap "Confirm" on Telegram → PR appears.**

## How It Works

```
┌──────────────┐     ┌──────────────────────────┐
│  Telegram     │────▶│  Cloudflare Worker        │
│  Users        │     │  (Hono + D1 SQLite)       │
│               │     │                            │
│  Google Form  │────▶│  REST API + Cron Trigger   │
└──────────────┘     └────────────┬───────────────┘
                                  │
                        HTTP API (polling)
                                  │
                     ┌────────────▼───────────────┐
                     │  Claude Code (local)         │
                     │  /loop 5m /dabugs            │
                     │                              │
                     │  1. Fetch pending bugs        │
                     │  2. Read your code → diagnose │
                     │  3. Telegram notifies you     │
                     │  4. You confirm → AI fixes    │
                     │  5. PR created automatically  │
                     └──────────────────────────────┘
```

## Feedback Lifecycle

```
pending → diagnosing → diagnosed → confirmed → fixing → fixed
                          ↓            ↓
                     needs_review   rejected
```

| Status | Who | What happens |
|--------|-----|-------------|
| `pending` | User submits | Bug awaiting AI analysis |
| `diagnosing` | AI picks up | AI reading your code |
| `diagnosed` | AI completes | You get Telegram notification with diagnosis + fix plan |
| `confirmed` | You tap ✅ | AI will implement the fix |
| `fixing` | AI working | Creating branch, writing code, running tests |
| `fixed` | AI done | PR created, you and the user are notified |
| `rejected` | You tap ❌ | Won't fix / false positive |
| `needs_review` | AI unsure | AI can't diagnose, needs your manual review |

## Setup Guide

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### Step 1: Deploy the Cloudflare Worker

```bash
# Clone the repo
git clone https://github.com/tonypk/dabugs.git
cd dabugs/worker
npm install

# Login to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create dabugs-db
# ⚠️ Copy the database_id from the output and update wrangler.toml

# Initialize the database schema
wrangler d1 execute dabugs-db --remote --file=src/db/schema.sql

# Set secrets
wrangler secret put DABUGS_API_KEY          # Generate one: openssl rand -hex 16 | sed 's/^/dbg_/'
wrangler secret put BOT_TOKEN               # From @BotFather
wrangler secret put TELEGRAM_ADMIN_CHAT_ID  # Your Telegram user ID (for notifications)
wrangler secret put TELEGRAM_WEBHOOK_SECRET # Generate one: openssl rand -hex 24

# Deploy
wrangler deploy
```

Your Worker URL will be: `https://dabugs.<your-subdomain>.workers.dev`

### Step 2: Set Telegram Webhook

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://dabugs.<your-subdomain>.workers.dev/api/telegram/webhook?secret=<WEBHOOK_SECRET>"
```

### Step 3: Register Your Projects

```bash
# Register a project via API
curl -X POST "https://dabugs.<your-subdomain>.workers.dev/api/projects" \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"id": "myapp", "name": "My App", "repo": "user/myapp"}'
```

Or use the CLI:
```bash
cd dabugs/cli && npm install -g .
dabugs init                    # Enter your Worker URL + API key
dabugs add-project myapp \
  --repo user/myapp \
  --path /path/to/local/myapp
```

### Step 4: Install the Claude Code Skill

```bash
# Copy skill to Claude Code skills directory
mkdir -p ~/.claude/skills
cp skill/dabugs.md ~/.claude/skills/dabugs.md
```

### Step 5: Create the Local Config

Create `~/.dabugs/projects.json`:

```json
{
  "api_url": "https://dabugs.<your-subdomain>.workers.dev",
  "api_key": "dbg_your_api_key_here",
  "projects": {
    "myapp": {
      "name": "My App",
      "repo": "user/myapp",
      "local_path": "/absolute/path/to/myapp"
    }
  }
}
```

### Step 6: Start the Loop

```bash
claude "/loop 5m /dabugs"
```

Claude Code will now poll every 5 minutes for new bugs and confirmed fixes.

### Step 7 (Optional): Google Form Integration

1. Create a Google Form with fields: **Project** (dropdown), **Description** (long text), **Screenshot** (file upload)
2. Link responses to a Google Sheet
3. Create a [Service Account](https://console.cloud.google.com/iam-admin/serviceaccounts), share the Sheet with it (read-only)
4. Set the secrets:
   ```bash
   wrangler secret put GOOGLE_SERVICE_ACCOUNT_KEY  # Paste the full JSON key
   wrangler secret put GOOGLE_SHEET_ID             # Sheet ID from the URL
   ```
5. The Worker's cron trigger polls the Sheet every 5 minutes automatically

## Telegram Bot Usage

### In a Group Chat

Add the bot to your group. Users report bugs with a single command:

```
/bug Login button does nothing after clicking
```

If you have multiple projects, the bot shows a project selection keyboard first, then submits the bug.

### In Private Chat

Users can also DM the bot directly:

```
User: /bug
Bot:  Select a project:
      [MyApp] [OtherProject]
User: (taps MyApp)
Bot:  Describe the bug or send a screenshot:
User: Login page crashes on mobile
Bot:  ✅ Bug #42 recorded! [MyApp]
```

Or send text/photos directly — the bot will record them as bug reports.

### Developer Notifications

When AI diagnoses a bug, you receive:

```
🔍 Bug #42 Diagnosis [MyApp]

Description: Login button does nothing after clicking

Diagnosis:
handleSubmit() in LoginView.vue:45 is missing await.
API call returns before form state updates.

Fix Plan:
Add async/await to handleSubmit()

[✅ Confirm Fix]  [❌ Reject]
```

Tap **Confirm** → AI creates a branch, implements the fix, runs tests, and opens a PR.

## Architecture

| Component | Technology | Free Tier |
|-----------|-----------|-----------|
| Server | Cloudflare Worker (Hono) | 100k req/day |
| Database | Cloudflare D1 (SQLite) | 5GB |
| Bot | grammY (webhook mode) | — |
| Sheet Poller | Cron Trigger (every 5 min) | Free |
| AI Agent | Claude Code custom skill | — |
| CLI | TypeScript / Commander | — |

## REST API

All endpoints require `Authorization: Bearer <API_KEY>` header (except Telegram webhook).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/healthz` | Health check |
| GET | `/api/pending` | List pending feedbacks |
| GET | `/api/confirmed` | List confirmed feedbacks |
| POST | `/api/feedback` | Create a feedback |
| PATCH | `/api/feedback/:id/diagnose` | Submit diagnosis + fix plan |
| PATCH | `/api/feedback/:id/status` | Update feedback status |
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Register a project |
| POST | `/api/telegram/webhook` | Telegram webhook (auth via secret param) |

### Example: Create a Feedback

```bash
curl -X POST "https://dabugs.xxx.workers.dev/api/feedback" \
  -H "Authorization: Bearer dbg_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "myapp",
    "description": "Login button does nothing",
    "source": "api",
    "reporter_name": "John"
  }'
```

## Multi-Project Support

One bot and one Worker serve all your projects. Users select a project when reporting.

**Local config** (`~/.dabugs/projects.json`) maps `project_id` → local directory so Claude Code knows where to read code and create branches.

```json
{
  "api_url": "https://dabugs.xxx.workers.dev",
  "api_key": "dbg_xxx",
  "projects": {
    "myapp": {
      "name": "My App",
      "repo": "user/myapp",
      "local_path": "/Users/me/projects/myapp"
    },
    "other": {
      "name": "Other Project",
      "repo": "user/other",
      "local_path": "/Users/me/projects/other"
    }
  }
}
```

## Security

- **API Key auth** — stored as Cloudflare secret, never in code
- **Telegram webhook secret** — validates incoming requests are from Telegram
- **Human-in-the-loop** — AI never modifies code without your confirmation
- **Branch isolation** — all fixes on separate branches, never direct to main
- **Constant-time auth** — API key comparison resistant to timing attacks

## Project Structure

```
dabugs/
├── worker/                     # Cloudflare Worker
│   ├── src/
│   │   ├── index.ts            # Hono router + cron handler
│   │   ├── types.ts            # TypeScript interfaces
│   │   ├── middleware/auth.ts   # API key auth
│   │   ├── routes/
│   │   │   ├── feedback.ts     # Feedback CRUD
│   │   │   └── projects.ts     # Project management
│   │   ├── services/
│   │   │   ├── telegram.ts     # grammY bot + notifications
│   │   │   └── google-sheet.ts # Google Sheet poller (JWT)
│   │   └── db/
│   │       ├── schema.sql      # D1 schema
│   │       └── queries.ts      # Database operations
│   ├── test/                   # 33 tests (vitest + miniflare)
│   └── wrangler.toml
├── cli/                        # CLI tool
│   ├── src/
│   │   ├── index.ts            # Commander entry
│   │   ├── config.ts           # Config read/write
│   │   ├── init.ts             # dabugs init
│   │   └── add-project.ts      # dabugs add-project
│   └── test/                   # 3 tests
├── skill/
│   └── dabugs.md               # Claude Code custom skill
└── README.md
```

## License

MIT
