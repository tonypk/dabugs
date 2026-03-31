import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { migrateDb } from "./helpers";
import { insertProject } from "../src/db/queries";
import { app } from "../src/index";

describe("project routes", () => {
  beforeEach(async () => {
    await migrateDb();
  });

  describe("auth", () => {
    it("rejects request without Authorization header", async () => {
      const res = await app.request("/api/projects", {}, env);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Missing Authorization header");
    });

    it("rejects request with invalid API key", async () => {
      const res = await app.request(
        "/api/projects",
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

  describe("GET /api/projects", () => {
    it("lists all projects", async () => {
      await insertProject(env.DB, {
        id: "project1",
        name: "Project 1",
        repo: "user/project1",
      });

      await insertProject(env.DB, {
        id: "project2",
        name: "Project 2",
        repo: "user/project2",
        description: "Second project",
      });

      const res = await app.request(
        "/api/projects",
        {
          headers: { Authorization: `Bearer ${env.DABUGS_API_KEY}` },
        },
        env
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveLength(2);
      expect(json[0].id).toBe("project1");
      expect(json[1].id).toBe("project2");
    });

    it("returns empty array when no projects", async () => {
      const res = await app.request(
        "/api/projects",
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

  describe("POST /api/projects", () => {
    it("creates project with required fields", async () => {
      const res = await app.request(
        "/api/projects",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: "newproject",
            name: "New Project",
            repo: "user/newproject",
          }),
        },
        env
      );

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.id).toBe("newproject");
      expect(json.name).toBe("New Project");
      expect(json.repo).toBe("user/newproject");
    });

    it("creates project with optional description", async () => {
      const res = await app.request(
        "/api/projects",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: "described",
            name: "Described Project",
            repo: "user/described",
            description: "A well-described project",
          }),
        },
        env
      );

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.description).toBe("A well-described project");
    });

    it("rejects request without id", async () => {
      const res = await app.request(
        "/api/projects",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "No ID Project",
            repo: "user/noid",
          }),
        },
        env
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("id");
    });

    it("rejects request without name", async () => {
      const res = await app.request(
        "/api/projects",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: "noname",
            repo: "user/noname",
          }),
        },
        env
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("name");
    });

    it("rejects request without repo", async () => {
      const res = await app.request(
        "/api/projects",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: "norepo",
            name: "No Repo Project",
          }),
        },
        env
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("repo");
    });

    it("rejects duplicate project id", async () => {
      await insertProject(env.DB, {
        id: "duplicate",
        name: "First",
        repo: "user/first",
      });

      const res = await app.request(
        "/api/projects",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.DABUGS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: "duplicate",
            name: "Second",
            repo: "user/second",
          }),
        },
        env
      );

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });
  });
});
