import { describe, it, expect, beforeEach } from "vitest";
import { migrateDb, createTestProject } from "./helpers";
import {
  insertProject,
  listProjects,
  insertFeedback,
  listFeedbacksByStatus,
  updateFeedbackDiagnosis,
  updateFeedbackStatus,
} from "../src/db/queries";

describe("queries", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = await migrateDb();
  });

  describe("projects", () => {
    it("inserts and lists projects", async () => {
      const project = createTestProject();
      await insertProject(db, project);

      const projects = await listProjects(db);
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe("testproject");
      expect(projects[0].name).toBe("Test Project");
    });

    it("rejects duplicate project id", async () => {
      const project = createTestProject();
      await insertProject(db, project);
      await expect(insertProject(db, project)).rejects.toThrow();
    });
  });

  describe("feedbacks", () => {
    beforeEach(async () => {
      await insertProject(db, createTestProject());
    });

    it("inserts feedback and lists by status", async () => {
      await insertFeedback(db, {
        project_id: "testproject",
        source: "telegram",
        description: "Login broken",
        reporter_id: "123",
        reporter_name: "alice",
      });

      const pending = await listFeedbacksByStatus(db, "pending");
      expect(pending).toHaveLength(1);
      expect(pending[0].description).toBe("Login broken");
      expect(pending[0].status).toBe("pending");
    });

    it("updates feedback diagnosis", async () => {
      await insertFeedback(db, {
        project_id: "testproject",
        source: "telegram",
        description: "Login broken",
        reporter_id: "123",
        reporter_name: "alice",
      });

      const [feedback] = await listFeedbacksByStatus(db, "pending");
      const updated = await updateFeedbackDiagnosis(db, feedback.id, {
        diagnosis: "Missing await in submit handler",
        fix_plan: "Add async/await to handleSubmit()",
      });

      expect(updated.status).toBe("diagnosed");
      expect(updated.diagnosis).toBe("Missing await in submit handler");
    });

    it("updates feedback status", async () => {
      await insertFeedback(db, {
        project_id: "testproject",
        source: "telegram",
        description: "Login broken",
        reporter_id: "123",
        reporter_name: "alice",
      });

      const [feedback] = await listFeedbacksByStatus(db, "pending");
      const updated = await updateFeedbackStatus(db, feedback.id, {
        status: "confirmed",
      });

      expect(updated.status).toBe("confirmed");
    });

    it("updates status with pr_url", async () => {
      await insertFeedback(db, {
        project_id: "testproject",
        source: "telegram",
        description: "Login broken",
        reporter_id: "123",
        reporter_name: "alice",
      });

      const [feedback] = await listFeedbacksByStatus(db, "pending");
      const updated = await updateFeedbackStatus(db, feedback.id, {
        status: "fixed",
        pr_url: "https://github.com/user/repo/pull/1",
      });

      expect(updated.status).toBe("fixed");
      expect(updated.pr_url).toBe("https://github.com/user/repo/pull/1");
    });
  });
});
