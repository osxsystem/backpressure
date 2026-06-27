#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { argv, cwd } from "node:process";
import { fileURLToPath } from "node:url";
import commander from "commander";
import { build, formatArtifacts } from "./install/build.js";
import { InstallError } from "./install/errors.js";
import { bundledSkillsDir, init } from "./install/init.js";
import { DEFAULT_CAPABILITIES, resolveInstalledSkills } from "./install/plan.js";
import { remove } from "./install/remove.js";
import type { AgentTarget } from "./seam/targets.js";
import { listSkillDirs } from "./skills/load.js";

const { Command } = commander;

/**
 * Format an error as a CLI error line when it is an expected install failure.
 * Returns `backpressure: <message>` for {@link InstallError} instances; returns
 * `null` for any other error, which the caller should re-throw to surface the
 * full stack.
 */
export function cliErrorLine(err: unknown): string | null {
  if (err instanceof InstallError) {
    return `backpressure: ${(err as InstallError).message}`;
  }
  return null;
}

/**
 * Commander 4 has no variadic options, so a repeatable `--skill` collects each
 * occurrence into an array via this accumulator (seeded with `[]`).
 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

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
 * Build the Backpressure CLI program with its subcommands (`init`, `remove`,
 * `build`, `index`). Pure construction — registering this does NOT parse argv
 * or run any action, so it is safe to build in tests and assert the wiring.
 *
 * `init` and `remove` are wired to the real installer ({@link init} /
 * {@link remove}); `build` and `index` are minimal stubs in v0.
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
    .option(
      "--skill <name>",
      "A bundled skill to install in addition to the defaults (repeatable).",
      collect,
      [],
    )
    .option("--all-skills", "Install every bundled skill, not just the defaults.")
    .option(
      "--global",
      "Install skills only into the user-level skills dir (~/.claude/skills or ~/.codex/skills).",
    )
    .option(
      "--gate <command>",
      "Command the installed Stop-gate hook runs after each turn (default: pnpm test). Point at ./scripts/backpressure-gate.sh for the composite gate.",
      "pnpm test",
    )
    .action(
      async (options: {
        target: string;
        dryRun?: boolean;
        skill?: string[];
        allSkills?: boolean;
        global?: boolean;
        gate?: string;
      }) => {
        try {
          const target = parseTarget(options.target);
          const skillsSourceDir = bundledSkillsDir();
          const available = await listSkillDirs(skillsSourceDir);
          const skills = resolveInstalledSkills(available, {
            extra: options.skill,
            all: options.allSkills,
          });
          const baseDir = options.global ? homedir() : cwd();
          const result = await init(target, baseDir, {
            dryRun: options.dryRun,
            skillsSourceDir,
            capabilities: { ...DEFAULT_CAPABILITIES, skills },
            skillsOnly: options.global,
            gateCommand: options.gate,
          });
          const verb = result.written ? "Wrote" : "Planned";
          for (const file of result.plan) {
            process.stdout.write(`${verb}: ${file.path}\n`);
          }
        } catch (e) {
          const line = cliErrorLine(e);
          if (line === null) throw e;
          process.stderr.write(`${line}\n`);
          process.exitCode = 1;
        }
      },
    );

  program
    .command("remove")
    .description("Remove previously-installed Backpressure skills.")
    .option(
      "--target <target>",
      "Which CLI's skill dir to remove from (claude or codex).",
      "claude",
    )
    .option("--dry-run", "Show what would be removed without deleting anything.")
    .option(
      "--skill <name>",
      "A skill to remove (repeatable). Defaults to the default skill set.",
      collect,
      [],
    )
    .option("--all-skills", "Remove every bundled skill, not just the defaults.")
    .option(
      "--global",
      "Remove from the user-level skills dir (~/.claude/skills or ~/.codex/skills).",
    )
    .action(
      async (options: {
        target: string;
        dryRun?: boolean;
        skill?: string[];
        allSkills?: boolean;
        global?: boolean;
      }) => {
        try {
          const target = parseTarget(options.target);
          const skillsSourceDir = bundledSkillsDir();
          const available = await listSkillDirs(skillsSourceDir);
          const skills = resolveInstalledSkills(available, {
            extra: options.skill,
            all: options.allSkills,
          });
          const baseDir = options.global ? homedir() : cwd();
          const result = await remove(target, baseDir, {
            dryRun: options.dryRun,
            skills,
          });
          const dryRun = options.dryRun ?? false;
          for (const action of result.actions) {
            if (action.action === "removed") {
              process.stdout.write(`${dryRun ? "Would remove" : "Removed"}: ${action.path}\n`);
            } else if (action.action === "skipped-not-installed") {
              process.stdout.write(`Skipped (not installed): ${action.skill}\n`);
            } else {
              process.stdout.write(`Refused (not a skill dir): ${action.path}\n`);
            }
          }
        } catch (e) {
          const line = cliErrorLine(e);
          if (line === null) throw e;
          process.stderr.write(`${line}\n`);
          process.exitCode = 1;
        }
      },
    );

  program
    .command("build")
    .description("Compile and preview the per-target config (does not install).")
    .option("--target <target>", "Which CLI to compile for (claude or codex).", "claude")
    .option("--out <dir>", "Stage the compiled config under <dir> instead of printing it.")
    .action(async (options: { target: string; out?: string }) => {
      try {
        const target = parseTarget(options.target);
        const ops = await build(target, { out: options.out });
        if (options.out !== undefined) {
          for (const op of ops) {
            if (op.op === "write") process.stdout.write(`Staged: ${op.path}\n`);
          }
        } else {
          process.stdout.write(formatArtifacts(ops));
        }
      } catch (e) {
        const line = cliErrorLine(e);
        if (line === null) throw e;
        process.stderr.write(`${line}\n`);
        process.exitCode = 1;
      }
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
