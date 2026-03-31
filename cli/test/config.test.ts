import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readConfig, writeConfig } from "../src/config.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("config", () => {
  const testDir = join(tmpdir(), "dabugs-test-" + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    process.env.DABUGS_CONFIG_DIR = testDir;
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.DABUGS_CONFIG_DIR;
  });

  it("returns default config when file does not exist", () => {
    const config = readConfig();
    expect(config.api_url).toBe("");
    expect(config.api_key).toBe("");
    expect(config.projects).toEqual({});
  });

  it("writes and reads config", () => {
    const config = {
      api_url: "https://dabugs.test.workers.dev",
      api_key: "dbg_test123",
      projects: {
        myapp: { name: "My App", repo: "user/myapp", local_path: "/home/user/myapp" },
      },
    };
    writeConfig(config);
    const loaded = readConfig();
    expect(loaded).toEqual(config);
  });

  it("adds a project to existing config", () => {
    writeConfig({ api_url: "https://test.workers.dev", api_key: "dbg_test", projects: {} });
    const config = readConfig();
    const updated = {
      ...config,
      projects: {
        ...config.projects,
        newproj: { name: "New Project", repo: "user/newproj", local_path: "/home/user/newproj" },
      },
    };
    writeConfig(updated);
    const reloaded = readConfig();
    expect(reloaded.projects.newproj.name).toBe("New Project");
  });
});
