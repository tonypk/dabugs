import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export interface ProjectConfig {
  name: string;
  repo: string;
  local_path: string;
}

export interface DabugsConfig {
  api_url: string;
  api_key: string;
  projects: Record<string, ProjectConfig>;
}

export function getConfigDir(): string {
  return process.env.DABUGS_CONFIG_DIR || join(homedir(), ".dabugs");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "projects.json");
}

export function readConfig(): DabugsConfig {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return {
      api_url: "",
      api_key: "",
      projects: {},
    };
  }

  const content = readFileSync(configPath, "utf-8");
  return JSON.parse(content) as DabugsConfig;
}

export function writeConfig(config: DabugsConfig): void {
  const configDir = getConfigDir();

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}
