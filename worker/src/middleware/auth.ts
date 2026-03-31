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
