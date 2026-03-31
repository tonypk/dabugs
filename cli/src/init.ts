import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readConfig, writeConfig, getConfigDir } from "./config.js";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function initCommand(): Promise<void> {
  const rl = createInterface({ input, output });

  console.log("🐛 DaBugs Initialization\n");

  const config = readConfig();

  let apiUrl = config.api_url;
  let apiKey = config.api_key;

  if (!apiUrl) {
    apiUrl = await rl.question("Worker URL (e.g. https://dabugs.yourname.workers.dev): ");
  } else {
    console.log(`Current Worker URL: ${apiUrl}`);
    const change = await rl.question("Change? (y/N): ");
    if (change.toLowerCase() === "y") {
      apiUrl = await rl.question("New Worker URL: ");
    }
  }

  if (!apiKey) {
    apiKey = await rl.question("API Key: ");
  } else {
    console.log(`Current API Key: ${apiKey.slice(0, 10)}...`);
    const change = await rl.question("Change? (y/N): ");
    if (change.toLowerCase() === "y") {
      apiKey = await rl.question("New API Key: ");
    }
  }

  rl.close();

  const updatedConfig = {
    ...config,
    api_url: apiUrl,
    api_key: apiKey,
  };

  writeConfig(updatedConfig);

  console.log(`\n✅ Config saved to ${getConfigDir()}/projects.json\n`);

  // Copy skill file if it exists
  const skillSourcePath = join(__dirname, "../../skill/dabugs.md");
  const skillDestDir = join(homedir(), ".claude", "skills");
  const skillDestPath = join(skillDestDir, "dabugs.md");

  if (existsSync(skillSourcePath)) {
    if (!existsSync(skillDestDir)) {
      mkdirSync(skillDestDir, { recursive: true });
    }
    copyFileSync(skillSourcePath, skillDestPath);
    console.log(`✅ Claude Code skill installed to ${skillDestPath}\n`);
  } else {
    console.log(`⚠️  Skill file not found at ${skillSourcePath}`);
    console.log(`   You can manually copy skill/dabugs.md to ~/.claude/skills/\n`);
  }

  console.log("Next steps:");
  console.log("  1. Add a project: dabugs add-project <id> --repo <owner/repo> --path <local-path>");
  console.log("  2. Use /dabugs in Claude Code to report bugs");
}
