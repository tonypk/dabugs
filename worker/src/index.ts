import { Hono } from "hono";
import type { Env } from "./types";
import { apiKeyAuth } from "./middleware/auth";
import { feedback } from "./routes/feedback";
import { projects } from "./routes/projects";
import { createWebhookHandler } from "./services/telegram";

export const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.text("ok"));

// Telegram webhook (own auth via secret param) — BEFORE apiKeyAuth middleware
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
    // Placeholder for Google Sheet polling (Task 5)
  },
};
