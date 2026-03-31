import { Hono } from "hono";
import type { Env } from "./types";
import { apiKeyAuth } from "./middleware/auth";
import { feedback } from "./routes/feedback";
import { projects } from "./routes/projects";

export const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.text("ok"));

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
