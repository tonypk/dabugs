import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { migrateDb, createTestProject } from "./helpers";
import { insertProject, insertFeedback } from "../src/db/queries";
import { app } from "../src/index";

describe("feedback routes", () => {
  beforeEach(async () => {
    await migrateDb();
    await insertProject(env.DB, createTestProject());
  });

  describe("auth", () => {
    it("rejects request without Authorization header", async () => {
      const res = await app.request("/api/pending", {}, env);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Missing Authorization header");
    });

    it("rejects request with invalid API key", async () => {
      const res = await app.request(
        "/api/pending",
        {
          headers: { Authorization: "Bearer wrong-key" },
        },
        env
      );
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Invalid API key");
    });
  });

  describe("GET /api/pending", () => {
    it("lists pending feedbacks", async () => {
      await insertFeedback(env.DB, {
        project_id: "testproject",
        source: "telegram",
        description: "Bug 1",
      });

      const res = await app.request(
        "/api/pending",
        {
          headers: { Authorization: `Bearer ${env.DABUGS_API_KEY}` },
        },
        env
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveLength(1);
      expect(json[0].description).toBe("Bug 1");
      expect(json[0].status).toBe("pending");
    });

    it("returns empty array when no pending feedbacks", async () => {
      const res = await app.request(
        "/api/pending",
        {
          headers: { Authorization: `Bearer ${env.DABUGS_API_KEY}` },
        },
        env
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual([]);
    });
  });

  describe("GET /api/confirmed", () => {
    it("lists confirmed feedbacks", async () => {
      await insertFeedback(env.DB, {
        project_id: "testproject",
        source: "telegram",
        description: "Confirmed bug",
      });

      // Change status to confirmed
      await env.DB.prepare(
        "UPDATE feedbacks SET status = 'confirmed' WHERE id = 1"
      ).run();

      const res = await app.request(
        "/api/confirmed",
        {
          headers: { Authorization: `Bearer ${env.DABUGS_API_KEY}` },
        },
        env
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveLength(1);
      expect(json[0].status).toBe("confirmed");
    });
  });

  describe("POST /api/feedback", () => {
    it("creates feedback with required fields", async () => {
      const res = await app.request(
        "/api/feedback",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            project_id: "testproject",
            description: "New bug",
          }),
        },
        env
      );

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.description).toBe("New bug");
      expect(json.source).toBe("telegram");
      expect(json.status).toBe("pending");
    });

    it("rejects request without project_id", async () => {
      const res = await app.request(
        "/api/feedback",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            description: "New bug",
          }),
        },
        env
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("project_id");
    });

    it("rejects request without description", async () => {
      const res = await app.request(
        "/api/feedback",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            project_id: "testproject",
          }),
        },
        env
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("description");
    });

    it("accepts custom source", async () => {
      const res = await app.request(
        "/api/feedback",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            project_id: "testproject",
            description: "Google form bug",
            source: "google_form",
          }),
        },
        env
      );

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.source).toBe("google_form");
    });
  });

  describe("PATCH /api/feedback/:id/diagnose", () => {
    beforeEach(async () => {
      await insertFeedback(env.DB, {
        project_id: "testproject",
        source: "telegram",
        description: "Bug to diagnose",
      });
    });

    it("updates diagnosis and fix_plan", async () => {
      const res = await app.request(
        "/api/feedback/1/diagnose",
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            diagnosis: "Missing null check",
            fix_plan: "Add if (!data) return",
          }),
        },
        env
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.diagnosis).toBe("Missing null check");
      expect(json.fix_plan).toBe("Add if (!data) return");
      expect(json.status).toBe("diagnosed");
    });

    it("rejects request without diagnosis", async () => {
      const res = await app.request(
        "/api/feedback/1/diagnose",
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fix_plan: "Add if (!data) return",
          }),
        },
        env
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("diagnosis");
    });

    it("rejects request without fix_plan", async () => {
      const res = await app.request(
        "/api/feedback/1/diagnose",
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            diagnosis: "Missing null check",
          }),
        },
        env
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("fix_plan");
    });

    it("returns 404 for non-existent feedback", async () => {
      const res = await app.request(
        "/api/feedback/999/diagnose",
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            diagnosis: "Test",
            fix_plan: "Test",
          }),
        },
        env
      );

      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/feedback/:id/status", () => {
    beforeEach(async () => {
      await insertFeedback(env.DB, {
        project_id: "testproject",
        source: "telegram",
        description: "Bug to update",
      });
    });

    it("updates status", async () => {
      const res = await app.request(
        "/api/feedback/1/status",
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status: "confirmed",
          }),
        },
        env
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("confirmed");
    });

    it("updates status with pr_url", async () => {
      const res = await app.request(
        "/api/feedback/1/status",
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status: "fixed",
            pr_url: "https://github.com/user/repo/pull/123",
          }),
        },
        env
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("fixed");
      expect(json.pr_url).toBe("https://github.com/user/repo/pull/123");
    });

    it("rejects request without status", async () => {
      const res = await app.request(
        "/api/feedback/1/status",
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
        env
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("status");
    });

    it("returns 404 for non-existent feedback", async () => {
      const res = await app.request(
        "/api/feedback/999/status",
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status: "confirmed",
          }),
        },
        env
      );

      expect(res.status).toBe(404);
    });
  });
});
