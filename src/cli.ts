#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import commander from "commander";
import { init } from "./install/init.js";
import type { AgentTarget } from "./seam/targets.js";

const { Command } = commander;

/** The agent CLIs `init` can target, used to validate `--target`. */
const TARGETS: readonly AgentTarget[] = ["claude", "codex"];

/** Narrow an arbitrary string to a known {@link AgentTarget}, or throw. */
function parseTarget(value: string): AgentTarget {
  if ((TARGETS as readonly string[]).includes(value)) {
    return value as AgentTarget;
  }
  throw new Error(`Unknown target "${value}". Expected one of: ${TARGETS.join(", ")}.`);
}

/**
 * Build the Backpressure CLI program with its three subcommands (`init`,
 * `build`, `index`). Pure construction — registering this does NOT parse argv
 * or run any action, so it is safe to build in tests and assert the wiring.
 *
 * `init` is wired to the real installer ({@link init}); `build` and `index`
 * are minimal stubs in v0.
 */
export function buildProgram(): commander.Command {
  const program = new Command();
  program
    .name("backpressure")
    .description("A capability pack for agentic coding CLIs (Claude Code and Codex CLI).");

  program
    .command("init")
    .description("Install Backpressure's capabilities into the current repo.")
    .option("--target <target>", "Which CLI to compile for (claude or codex).", "claude")
    .option("--dry-run", "Compute the plan and print it without writing files.")
    .action(async (options: { target: string; dryRun?: boolean }) => {
      const target = parseTarget(options.target);
      const result = await init(target, process.cwd(), { dryRun: options.dryRun });
      const verb = result.written ? "Wrote" : "Planned";
      for (const file of result.plan) {
        process.stdout.write(`${verb}: ${file.path}\n`);
      }
    });

  program
    .command("build")
    .description("Build the distributable artifacts (stub).")
    .action(() => {
      process.stdout.write("build: not yet implemented\n");
    });

  program
    .command("index")
    .description("Index the installed capabilities (stub).")
    .action(() => {
      process.stdout.write("index: not yet implemented\n");
    });

  return program;
}

/** True when this module is the process entry point (run as the bin, not imported). */
function isMain(): boolean {
  const entry = argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  buildProgram().parse(argv);
}
