import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitClaudeAgents } from "../adapters/claude/agents.js";
import { emitClaudeHooks } from "../adapters/claude/hooks.js";
import { emitClaudeMcp } from "../adapters/claude/mcp.js";
import { emitCodexAgents } from "../adapters/codex/agents.js";
import { emitCodexHooks } from "../adapters/codex/hooks.js";
import { emitCodexMcp } from "../adapters/codex/mcp.js";
import type { HookDefinition } from "../adapters/common/hooks.js";
import type { AgentTarget } from "../seam/targets.js";
import { nodeSkillsIo, type SkillsIo } from "../skills/load.js";
import { verifySkills } from "../skills/verify.js";
import { isEnoent, MissingSkillSourceError, SkillVerificationError } from "./errors.js";
import {
  DEFAULT_CAPABILITIES,
  type InstallCapabilities,
  type PlannedFile,
  planInstall,
} from "./plan.js";

/**
 * Build the Stop-gate hook that runs `command` after each turn — the single
 * place the gate command becomes a {@link HookDefinition}. `init`'s `gateCommand`
 * flows through here, so a repo can point the gate at the composite
 * `./scripts/backpressure-gate.sh` without hand-editing the emitted config.
 */
export function stopGateHooks(command: string): HookDefinition[] {
  return [{ event: "Stop", command }];
}

/** The default hooks Backpressure installs: a Stop-gate that runs `pnpm test`. */
export const DEFAULT_HOOKS: HookDefinition[] = stopGateHooks("pnpm test");

/**
 * True when `command` is a bare package-manager `test` invocation (e.g.
 * `pnpm test`, `npm run test`, `yarn test`). Such a gate depends on the target
 * repo having a `scripts.test` — so when the repo has none, the Stop gate
 * silently no-ops/errors and {@link init} warns. A custom `--gate` (a script
 * path, a build command) does not match, so it is never second-guessed.
 */
export function isPackageTestGate(command: string): boolean {
  return /^(pnpm|npm|yarn|bun)(\s+run)?\s+test$/.test(command.trim());
}

/** The slice of a target repo's `package.json` the installer reads. */
interface TargetPackageJson {
  scripts?: Record<string, unknown>;
  /** Corepack's authoritative declaration, e.g. `"pnpm@8.6.0"`. */
  packageManager?: unknown;
}

/**
 * Read and parse the target repo's `package.json`, or `null` if it is absent,
 * unreadable, or unparseable. Goes through the injected {@link InstallIo} so it
 * stays unit-testable, and never throws — every result it feeds is advisory.
 */
async function readTargetPackageJson(
  repoPath: string,
  io: InstallIo,
): Promise<TargetPackageJson | null> {
  let raw: string;
  try {
    raw = await io.readText(join(repoPath, "package.json"));
  } catch {
    return null; // absent (ENOENT) or unreadable
  }
  try {
    return JSON.parse(raw) as TargetPackageJson;
  } catch {
    return null; // unparseable
  }
}

/** Whether `pkg` declares a non-empty `scripts.test`. */
function hasTestScript(pkg: TargetPackageJson | null): boolean {
  const test = pkg?.scripts?.test;
  return typeof test === "string" && test.trim() !== "";
}

/** Package managers Backpressure can emit a `<pm> test` Stop gate for. */
const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/**
 * Lockfile → package manager, in detection priority order. A repo can carry more
 * than one lockfile during a migration; the first match wins.
 */
const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
];

/**
 * Detect the package manager the target repo at `repoPath` uses, so the default
 * Stop gate can be emitted as `<pm> test` and actually run. Precedence:
 *   1. the `packageManager` field in `package.json` (corepack's declaration),
 *   2. a lockfile ({@link LOCKFILES} priority order),
 *   3. `pnpm` as the fallback (Backpressure's historical default).
 * Lockfile existence is probed through the injected {@link InstallIo} (a
 * successful read = present); never throws.
 */
export async function detectPackageManager(
  repoPath: string,
  io: InstallIo,
  pkg: TargetPackageJson | null,
): Promise<PackageManager> {
  const declared = pkg?.packageManager;
  if (typeof declared === "string") {
    const name = declared.split("@", 1)[0] ?? "";
    if ((PACKAGE_MANAGERS as readonly string[]).includes(name)) {
      return name as PackageManager;
    }
  }
  for (const [file, pm] of LOCKFILES) {
    try {
      await io.readText(join(repoPath, file));
      return pm; // a successful read means the lockfile is present
    } catch {
      // absent — try the next candidate
    }
  }
  return "pnpm";
}

/**
 * The slice of the filesystem {@link init} needs. Injectable so tests can
 * supply an in-memory fake (and assert dry-run touches nothing) instead of
 * writing to disk.
 */
export interface InstallIo {
  /**
   * List every file under `dir`, recursively, as paths relative to `dir`.
   * Used to mirror a bundled skill's whole tree (scripts, references, assets,
   * not just its `SKILL.md`). Throws an ENOENT-coded error if `dir` is absent.
   */
  listFiles(dir: string): Promise<string[]>;
  /** Create a directory (and parents) if absent. */
  ensureDir(path: string): Promise<void>;
  /** Read a UTF-8 text file at `path`. Throws an ENOENT-coded error if absent. */
  readText(path: string): Promise<string>;
  /** Write a UTF-8 text file at `path`. */
  writeText(path: string, data: string): Promise<void>;
  /**
   * Copy a file's raw bytes (and its permission mode) from `from` to `to`.
   * Used for bundled skill resources so binary assets and the executable bit on
   * scripts survive the install — a UTF-8 text round-trip would corrupt either.
   */
  copyFile(from: string, to: string): Promise<void>;
  /**
   * Mark `path` executable (chmod +x). Optional so existing in-memory test fakes
   * need not implement it; the node impl sets mode 0o755. Used by writeTunedGate
   * for the generated gate script (a text writeText would otherwise drop +x).
   */
  makeExecutable?(path: string): Promise<void>;
}

/** Default {@link InstallIo} backed by `node:fs/promises`. */
export const nodeInstallIo: InstallIo = {
  async listFiles(dir) {
    // Hand-rolled walk so the returned paths are relative to `dir` regardless
    // of Node version (readdir's recursive Dirent.parentPath/.path differ
    // across 20.x). A first-level ENOENT propagates so callers can map it to a
    // MissingSkillSourceError.
    const out: string[] = [];
    const walk = async (current: string, prefix: string): Promise<void> => {
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const rel = prefix ? join(prefix, entry.name) : entry.name;
        if (entry.isDirectory()) {
          await walk(join(current, entry.name), rel);
        } else if (entry.isFile()) {
          out.push(rel);
        }
      }
    };
    await walk(dir, "");
    return out;
  },
  async readText(path) {
    return readFile(path, "utf8");
  },
  async ensureDir(path) {
    await mkdir(path, { recursive: true });
  },
  async writeText(path, data) {
    await writeFile(path, data, "utf8");
  },
  async copyFile(from, to) {
    // node:fs copyFile carries the source's permission mode, so an executable
    // script stays executable at the destination.
    await copyFile(from, to);
  },
  async makeExecutable(path) {
    await chmod(path, 0o755);
  },
};

/**
 * Resolve the pack's *own* bundled skills dir (`<package-root>/skills`),
 * independent of the caller's cwd, so `init` can install into any target repo
 * while still sourcing skills from the pack. Walks up from this module to the
 * nearest `package.json` — which is the repo root in dev (`src/…`) and the
 * package root once built (`dist/cli.js`). Falls back to `<cwd>/skills` if no
 * package root is found (e.g. an unusual bundling layout).
 */
export function bundledSkillsDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let hops = 0; hops < 16; hops++) {
    if (existsSync(join(dir, "package.json"))) return join(dir, "skills");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(process.cwd(), "skills");
}

/** Options for {@link init}. */
export interface InitOptions {
  /** When true, compute the plan but write nothing. Defaults to false. */
  dryRun?: boolean;
  /** Capabilities to compile; defaults to {@link DEFAULT_CAPABILITIES}. */
  capabilities?: InstallCapabilities;
  /**
   * Absolute path to the bundled skills source dir (whose trees are copied in).
   * Defaults to the pack's own {@link bundledSkillsDir}, so an install sources
   * skills from the pack regardless of the target repo's cwd.
   */
  skillsSourceDir?: string;
  /** Filesystem wrapper; defaults to {@link nodeInstallIo}. Injected in tests. */
  io?: InstallIo;
  /**
   * Skills filesystem wrapper used for pre-install verification only; defaults
   * to {@link nodeSkillsIo}. Injected in tests to provide a fake skill source
   * without touching disk.
   */
  skillsIo?: SkillsIo;
  /**
   * When true, filter the install plan to skills only — hooks, MCP server
   * registrations, and agent files are not written. Intended for `--global`
   * installs that write skills into `~/.claude/skills` or `~/.codex/skills`
   * without affecting any project-level config.
   */
  skillsOnly?: boolean;
  /**
   * Command the installed Stop-gate hook runs after each turn. When omitted, it
   * defaults to an auto-detected `<pm> test` — the target repo's package manager
   * (`packageManager` field → lockfile → `pnpm` fallback) via
   * {@link detectPackageManager}. Point it at `./scripts/backpressure-gate.sh` to
   * install the composite gate instead of bare tests. Stays an opaque string
   * through the installer — only the per-target adapters render it (the
   * author-once, compile-per-target seam).
   */
  gateCommand?: string;
}

/** The outcome of {@link init}: the plan, and whether files were actually written. */
export interface InitResult {
  /** The planned files (same as {@link planInstall} would return). */
  plan: PlannedFile[];
  /** True if files were written to disk; false for a dry run. */
  written: boolean;
  /**
   * Non-fatal advisories for the caller to surface (e.g. the installed Stop gate
   * runs a package `test` script the target repo doesn't define). Reported for a
   * dry run too, so dry-run and the real run agree. Empty when nothing is amiss.
   */
  warnings: string[];
}

/**
 * One install operation. Generated config is materialised in memory, so it's a
 * text {@link WriteOp.write}; bundled skill resources already exist on disk and
 * are byte-copied ({@link WriteOp.copy}) so binaries and the executable bit
 * survive.
 */
export type WriteOp =
  | { op: "write"; path: string; contents: string }
  | { op: "copy"; path: string; from: string };

/**
 * Compile the write operations for `target`: per-target config bodies derived
 * from the shared definitions (text), plus a byte-copy per bundled skill file.
 * Skill resources are sourced from `skillsSourceDir`. Performs no writes itself;
 * it only enumerates skill trees through `io`. Exported so `backpressure build`
 * (`src/install/build.ts`) compiles the SAME bytes `init` installs — the single
 * per-target emit path, so the two cannot drift.
 */
export async function compileArtifacts(
  target: AgentTarget,
  plan: PlannedFile[],
  capabilities: InstallCapabilities,
  hooks: HookDefinition[],
  skillsSourceDir: string,
  io: InstallIo,
): Promise<WriteOp[]> {
  const writes: WriteOp[] = [];

  // Pre-compile the per-target config bodies once.
  const claudeAgents = target === "claude" ? emitClaudeAgents(capabilities.subagents) : [];

  for (const file of plan) {
    if (file.kind === "skill") {
      // Mirror the bundled skill's *whole* tree, not just SKILL.md — a skill's
      // scripts/references/assets are load-bearing (skill-creator references
      // its own scripts/ and eval-viewer/). The planned `file.path` is the
      // skill's destination SKILL.md, so its dir is the destination skill root
      // and its parent dir name is the skill (== source dir name).
      const skillName = basename(dirname(file.path));
      const sourceSkillDir = join(skillsSourceDir, skillName);
      const destSkillDir = dirname(file.path);
      let relPaths: string[];
      try {
        relPaths = await io.listFiles(sourceSkillDir);
      } catch (e) {
        if (isEnoent(e)) throw new MissingSkillSourceError(skillName, skillsSourceDir);
        throw e;
      }
      // An empty source dir means the skill isn't really there — treat it the
      // same as a missing source rather than silently installing nothing.
      if (relPaths.length === 0) throw new MissingSkillSourceError(skillName, skillsSourceDir);
      // Byte-copy each file (preserving binary content + exec bit) rather than a
      // text round-trip.
      for (const rel of relPaths) {
        writes.push({
          op: "copy",
          path: join(destSkillDir, rel),
          from: join(sourceSkillDir, rel),
        });
      }
      continue;
    }

    if (target === "claude") {
      if (file.kind === "hooks") {
        writes.push({
          op: "write",
          path: file.path,
          contents: `${JSON.stringify(emitClaudeHooks(hooks), null, 2)}\n`,
        });
      } else if (file.kind === "mcp") {
        writes.push({
          op: "write",
          path: file.path,
          contents: `${JSON.stringify(emitClaudeMcp(capabilities.mcpServers ?? []), null, 2)}\n`,
        });
      } else if (file.kind === "agent") {
        const base = basename(file.path);
        const match = claudeAgents.find((a) => basename(a.path) === base);
        if (match) writes.push({ op: "write", path: file.path, contents: match.contents });
      }
      continue;
    }

    // target === "codex": one config.toml carries hooks + mcp_servers + agents.
    // The mcp_servers table is omitted entirely when no servers are registered
    // (the v0 default) rather than emitting an empty table.
    if (file.kind === "hooks") {
      const mcpServers = capabilities.mcpServers ?? [];
      const fragments = [emitCodexHooks(hooks)];
      if (mcpServers.length > 0) fragments.push(emitCodexMcp(mcpServers));
      fragments.push(emitCodexAgents(capabilities.subagents));
      writes.push({ op: "write", path: file.path, contents: fragments.join("\n") });
    }
  }

  return writes;
}

/**
 * Compile and install Backpressure's capabilities into `repoPath` for `target`.
 * Computes the plan via {@link planInstall}, derives each file's contents from
 * the shared definitions, then — unless `dryRun` — writes them (creating parent
 * dirs first) through the injected {@link InstallIo}.
 *
 * Returns the plan plus whether anything was written. A dry run writes NOTHING
 * and returns the plan, so callers can preview an install.
 */
export async function init(
  target: AgentTarget,
  repoPath: string,
  options: InitOptions = {},
): Promise<InitResult> {
  const {
    dryRun = false,
    capabilities = DEFAULT_CAPABILITIES,
    skillsSourceDir = bundledSkillsDir(),
    io = nodeInstallIo,
    skillsIo = nodeSkillsIo,
    skillsOnly = false,
  } = options;

  let plan = planInstall(target, repoPath, capabilities);

  if (skillsOnly) {
    plan = plan.filter((f) => f.kind === "skill");
  }

  // Validate every skill in the resolved set BEFORE writing anything, so a
  // broken skill definition is caught atomically (a dry run also reports
  // problems honestly — it just wouldn't write).
  const problems = await verifySkills(skillsSourceDir, capabilities.skills, skillsIo);
  if (problems.length > 0) {
    throw new SkillVerificationError(problems);
  }

  // Resolve the Stop-gate command and any advisory, reading the target's
  // package.json once. An explicit `--gate` wins verbatim; otherwise emit
  // `<pm> test` for the package manager detected from the repo (lockfile /
  // `packageManager` field, pnpm fallback) so the default gate actually runs.
  // Under `skillsOnly` no Stop hook is installed, so detection is skipped and the
  // command (unused) stays at the historical default.
  const warnings: string[] = [];
  let gateCommand: string;
  if (skillsOnly) {
    gateCommand = options.gateCommand ?? "pnpm test";
  } else {
    const pkg = await readTargetPackageJson(repoPath, io);
    gateCommand = options.gateCommand ?? `${await detectPackageManager(repoPath, io, pkg)} test`;
    // Warn when the gate runs a package `test` script the repo doesn't define —
    // the gate would silently no-op/error on every Stop. Computed for dry runs too.
    if (isPackageTestGate(gateCommand) && !hasTestScript(pkg)) {
      warnings.push(
        `no 'test' script found in the target package.json — the Stop gate (\`${gateCommand}\`) will not run. Pass --gate <command> to point it at your test or build command.`,
      );
    }
  }

  if (dryRun) {
    return { plan, written: false, warnings };
  }

  const writes = await compileArtifacts(
    target,
    plan,
    capabilities,
    stopGateHooks(gateCommand),
    skillsSourceDir,
    io,
  );
  for (const write of writes) {
    await io.ensureDir(dirname(write.path));
    if (write.op === "write") {
      await io.writeText(write.path, write.contents);
    } else {
      await io.copyFile(write.from, write.path);
    }
  }

  return { plan, written: true, warnings };
}
