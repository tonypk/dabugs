import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

export const apiKeyAuth = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ error: "Missing Authorization header" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    if (!timingSafeEqual(token, c.env.DABUGS_API_KEY)) {
      return c.json({ error: "Invalid API key" }, 401);
    }

    await next();
  }
);
