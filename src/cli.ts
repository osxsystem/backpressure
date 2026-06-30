#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { argv, cwd } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import commander from "commander";
import { addPack } from "./add/add.js";
import { nodeBytesIo, nodePackFetcher } from "./add/fetch.js";
import { installPack } from "./add/install-pack.js";
import { build, formatArtifacts } from "./install/build.js";
import { InstallError } from "./install/errors.js";
import { bundledSkillsDir, init, nodeInstallIo } from "./install/init.js";
import { formatInventory, inventory } from "./install/inventory.js";
import { DEFAULT_CAPABILITIES, resolveInstalledSkills } from "./install/plan.js";
import { remove } from "./install/remove.js";
import { installWithLoop } from "./install/with-loop.js";
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

/**
 * Narrow an arbitrary string to a known {@link AgentTarget}, or throw an
 * {@link InstallError} so an unknown `--target` surfaces as a clean
 * `backpressure: …` line (via {@link cliErrorLine}) instead of a raw stack.
 */
export function parseTarget(value: string): AgentTarget {
  if ((TARGETS as readonly string[]).includes(value)) {
    return value as AgentTarget;
  }
  throw new InstallError(`unknown target "${value}". Expected one of: ${TARGETS.join(", ")}.`);
}

/** Read a y/N confirmation from stdin (used by `add`'s trust gate). */
async function ttyConfirm(summary: string): Promise<boolean> {
  process.stdout.write(`${summary}\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question("Proceed? [y/N] ")).trim().toLowerCase();
    return a === "y" || a === "yes";
  } finally {
    rl.close();
  }
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
      "Command the installed Stop-gate hook runs after each turn. Default: an auto-detected `<pm> test` from the repo's package manager (lockfile / packageManager field, pnpm fallback). Point at ./scripts/backpressure-gate.sh for the composite gate.",
    )
    .option(
      "--with-loop",
      "Also install the bundled backpressure-loop pack and a stack-tuned gate (claude only).",
    )
    .option(
      "--from <dir>",
      "Install a local capability pack (a dir with backpressure.json) instead of the bundled defaults.",
    )
    .action(
      async (options: {
        target: string;
        dryRun?: boolean;
        skill?: string[];
        allSkills?: boolean;
        global?: boolean;
        gate?: string;
        withLoop?: boolean;
        from?: string;
      }) => {
        if (options.from !== undefined) {
          try {
            if (options.global) {
              throw new InstallError(
                "init --from does not support --global yet — it would overwrite your global ~/.claude/settings.json. Run it inside the target repo without --global.",
              );
            }
            if (options.dryRun) {
              throw new InstallError("init --from does not support --dry-run yet.");
            }
            const target = parseTarget(options.target);
            const baseDir = options.global ? homedir() : cwd();
            const { installed, notices } = await installPack(
              resolve(options.from),
              target,
              baseDir,
            );
            for (const f of installed.files) process.stdout.write(`Wrote: ${join(baseDir, f)}\n`);
            for (const n of notices) process.stdout.write(`Note: ${n}\n`);
          } catch (e) {
            const line = cliErrorLine(e);
            if (line === null) throw e;
            process.stderr.write(`${line}\n`);
            process.exitCode = 1;
          }
          return;
        }
        try {
          const target = parseTarget(options.target);
          if (options.withLoop) {
            const { profile } = await installWithLoop(target, cwd());
            process.stdout.write(`Installed the loop pack; gate tuned for: ${profile.kind}\n`);
            return;
          }
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
          for (const w of result.warnings) {
            process.stderr.write(`backpressure: ${w}\n`);
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
        // An empty/whitespace --out is a read-only preview, not staging.
        const out =
          options.out !== undefined && options.out.trim() !== "" ? options.out : undefined;
        const ops = await build(target, { out });
        if (out !== undefined) {
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
    .description("Report which Backpressure capabilities are installed in this repo.")
    .option("--target <target>", "Which CLI's install to inventory (claude or codex).", "claude")
    .option("--json", "Emit the inventory as a JSON array of { kind, path, present }.")
    .action(async (options: { target: string; json?: boolean }) => {
      try {
        const target = parseTarget(options.target);
        const entries = await inventory(target, { baseDir: cwd() });
        process.stdout.write(
          options.json ? `${JSON.stringify(entries, null, 2)}\n` : formatInventory(entries),
        );
      } catch (e) {
        const line = cliErrorLine(e);
        if (line === null) throw e;
        process.stderr.write(`${line}\n`);
        process.exitCode = 1;
      }
    });

  program
    .command("add <owner/repo>")
    .description("Install a capability pack from a GitHub repo into this repo.")
    .option("--target <target>", "Which CLI to compile for (claude or codex).", "claude")
    .option("--global", "Install into the user-level dirs (~/.claude or ~/.codex).")
    .option("--yes", "Skip the trust confirmation prompt (for CI).")
    .action(async (ref: string, options: { target: string; global?: boolean; yes?: boolean }) => {
      try {
        const choice = parseTarget(options.target);
        const baseDir = options.global ? homedir() : cwd();
        const { files, sha, notices } = await addPack(
          ref,
          { choice, baseDir, yes: options.yes },
          {
            io: nodeInstallIo,
            bytesIo: nodeBytesIo,
            fetcher: nodePackFetcher,
            prompter: { confirm: ttyConfirm },
          },
        );
        for (const f of files) process.stdout.write(`Wrote: ${join(baseDir, f)}\n`);
        for (const n of notices) process.stdout.write(`Note: ${n}\n`);
        process.stdout.write(`pinned ${ref.split("@")[0]}@${sha}\n`);
      } catch (e) {
        const line = cliErrorLine(e);
        if (line === null) throw e;
        process.stderr.write(`${line}\n`);
        process.exitCode = 1;
      }
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
