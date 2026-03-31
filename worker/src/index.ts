import type { Env } from "./types";

export default {
  fetch(request: Request, env: Env): Response {
    return new Response("DaBugs Worker", { status: 200 });
  },
};
