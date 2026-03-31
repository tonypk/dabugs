import { Hono } from "hono";
import type { Env } from "../types";
import {
  listFeedbacksByStatus,
  insertFeedback,
  updateFeedbackDiagnosis,
  updateFeedbackStatus,
  listProjects,
} from "../db/queries";
import {
  sendDiagnosisNotification,
  sendFixedNotification,
} from "../services/telegram";

export const feedback = new Hono<{ Bindings: Env }>();

// GET /api/pending
feedback.get("/pending", async (c) => {
  const feedbacks = await listFeedbacksByStatus(c.env.DB, "pending");
  return c.json(feedbacks);
});

// GET /api/confirmed
feedback.get("/confirmed", async (c) => {
  const feedbacks = await listFeedbacksByStatus(c.env.DB, "confirmed");
  return c.json(feedbacks);
});

// POST /api/feedback
feedback.post("/feedback", async (c) => {
  const body = await c.req.json();

  if (!body.project_id) {
    return c.json({ error: "Missing required field: project_id" }, 400);
  }

  if (!body.description) {
    return c.json({ error: "Missing required field: description" }, 400);
  }

  const source = body.source || "telegram";

  try {
    const newFeedback = await insertFeedback(c.env.DB, {
      project_id: body.project_id,
      source,
      description: body.description,
      reporter_id: body.reporter_id,
      reporter_name: body.reporter_name,
      screenshot_urls: body.screenshot_urls,
    });

    return c.json(newFeedback, 201);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

// PATCH /api/feedback/:id/diagnose
feedback.patch("/feedback/:id/diagnose", async (c) => {
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();

  if (!body.diagnosis) {
    return c.json({ error: "Missing required field: diagnosis" }, 400);
  }

  if (!body.fix_plan) {
    return c.json({ error: "Missing required field: fix_plan" }, 400);
  }

  try {
    const updated = await updateFeedbackDiagnosis(c.env.DB, id, {
      diagnosis: body.diagnosis,
      fix_plan: body.fix_plan,
    });

    // Send Telegram notification (non-blocking)
    try {
      const projects = await listProjects(c.env.DB);
      const project = projects.find((p) => p.id === updated.project_id);
      if (project) {
        await sendDiagnosisNotification(c.env, updated, project.name);
      }
    } catch (notificationError) {
      console.error("Failed to send diagnosis notification:", notificationError);
    }

    return c.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      return c.json({ error: `Feedback ${id} not found` }, 404);
    }
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

// PATCH /api/feedback/:id/status
feedback.patch("/feedback/:id/status", async (c) => {
  const id = parseInt(c.req.param("id"));
  const body = await c.req.json();

  if (!body.status) {
    return c.json({ error: "Missing required field: status" }, 400);
  }

  try {
    const updated = await updateFeedbackStatus(c.env.DB, id, {
      status: body.status,
      pr_url: body.pr_url,
    });

    // Send Telegram notification if status is fixed with PR URL (non-blocking)
    if (body.status === "fixed" && body.pr_url) {
      try {
        const projects = await listProjects(c.env.DB);
        const project = projects.find((p) => p.id === updated.project_id);
        if (project) {
          await sendFixedNotification(c.env, updated, project.name);
        }
      } catch (notificationError) {
        console.error("Failed to send fixed notification:", notificationError);
      }
    }

    return c.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      return c.json({ error: `Feedback ${id} not found` }, 404);
    }
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});
