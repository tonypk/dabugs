import { readConfig, writeConfig } from "./config.js";

interface AddProjectOptions {
  repo: string;
  path: string;
  name?: string;
}

export async function addProjectCommand(id: string, options: AddProjectOptions): Promise<void> {
  const config = readConfig();

  // Validate config exists
  if (!config.api_url || !config.api_key) {
    console.error("❌ Error: Config not initialized. Run 'dabugs init' first.");
    process.exit(1);
  }

  // Validate project doesn't already exist
  if (config.projects[id]) {
    console.error(`❌ Error: Project '${id}' already exists in config.`);
    process.exit(1);
  }

  const projectName = options.name || id;

  // Add project to config (immutably)
  const updatedConfig = {
    ...config,
    projects: {
      ...config.projects,
      [id]: {
        name: projectName,
        repo: options.repo,
        local_path: options.path,
      },
    },
  };

  writeConfig(updatedConfig);
  console.log(`✅ Project '${id}' added to local config`);

  // Register project on remote worker
  try {
    const response = await fetch(`${config.api_url}/api/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.api_key}`,
      },
      body: JSON.stringify({
        id,
        name: projectName,
        repo: options.repo,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`⚠️  Warning: Failed to register project on remote worker: ${response.status} ${errorText}`);
      console.warn("   Project saved locally, but may not be accessible on worker.");
    } else {
      console.log(`✅ Project registered on remote worker`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️  Warning: Could not connect to worker: ${errorMessage}`);
    console.warn("   Project saved locally, but may not be accessible on worker.");
  }

  console.log(`\n📁 Project '${id}' is ready!`);
  console.log(`   Use /dabugs in Claude Code to report bugs for this project.`);
}
