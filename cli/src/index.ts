#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./init.js";
import { addProjectCommand } from "./add-project.js";

const program = new Command();

program
  .name("dabugs")
  .description("AI-powered bug feedback loop")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize DaBugs configuration and install Claude Code skill")
  .action(async () => {
    await initCommand();
  });

program
  .command("add-project <id>")
  .description("Add a project to track")
  .requiredOption("--repo <owner/repo>", "GitHub repository")
  .requiredOption("--path <local-path>", "Local project path")
  .option("--name <display-name>", "Display name (defaults to id)")
  .action(async (id, options) => {
    await addProjectCommand(id, options);
  });

program.parse();
