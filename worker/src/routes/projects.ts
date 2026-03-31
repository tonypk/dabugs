import { Hono } from "hono";
import type { Env } from "../types";
import { listProjects, insertProject } from "../db/queries";

export const projects = new Hono<{ Bindings: Env }>();

// GET /api/projects
projects.get("/projects", async (c) => {
  const projectList = await listProjects(c.env.DB);
  return c.json(projectList);
});

// POST /api/projects
projects.post("/projects", async (c) => {
  const body = await c.req.json();

  if (!body.id) {
    return c.json({ error: "Missing required field: id" }, 400);
  }

  if (!body.name) {
    return c.json({ error: "Missing required field: name" }, 400);
  }

  if (!body.repo) {
    return c.json({ error: "Missing required field: repo" }, 400);
  }

  try {
    const project = await insertProject(c.env.DB, {
      id: body.id,
      name: body.name,
      repo: body.repo,
      description: body.description,
    });

    return c.json(project, 201);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});
