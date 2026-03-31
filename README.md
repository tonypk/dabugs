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
