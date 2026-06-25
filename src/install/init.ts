import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { emitClaudeAgents } from "../adapters/claude/agents.js";
import { emitClaudeHooks } from "../adapters/claude/hooks.js";
import { emitClaudeMcp } from "../adapters/claude/mcp.js";
import { emitCodexAgents } from "../adapters/codex/agents.js";
import { emitCodexHooks } from "../adapters/codex/hooks.js";
import { emitCodexMcp } from "../adapters/codex/mcp.js";
import type { HookDefinition } from "../adapters/common/hooks.js";
import type { McpServerDefinition } from "../adapters/common/mcp.js";
import type { AgentTarget } from "../seam/targets.js";
import {
  DEFAULT_CAPABILITIES,
  type InstallCapabilities,
  type PlannedFile,
  planInstall,
} from "./plan.js";

/** The default hooks Backpressure installs: a Stop-gate that runs the tests. */
export const DEFAULT_HOOKS: HookDefinition[] = [{ event: "Stop", command: "pnpm test" }];

/** The default MCP servers Backpressure registers: the issue tracker. */
export const DEFAULT_MCP_SERVERS: McpServerDefinition[] = [
  { name: "tracker", command: "node", args: ["dist/tracker/server.js"] },
];

/**
 * The slice of the filesystem {@link init} needs. Injectable so tests can
 * supply an in-memory fake (and assert dry-run touches nothing) instead of
 * writing to disk.
 */
export interface InstallIo {
  /** Read a UTF-8 text file (used to copy bundled skill sources). */
  readText(path: string): Promise<string>;
  /** Create a directory (and parents) if absent. */
  ensureDir(path: string): Promise<void>;
  /** Write a UTF-8 text file at `path`. */
  writeText(path: string, data: string): Promise<void>;
}

/** Default {@link InstallIo} backed by `node:fs/promises`. */
export const nodeInstallIo: InstallIo = {
  async readText(path) {
    return readFile(path, "utf8");
  },
  async ensureDir(path) {
    await mkdir(path, { recursive: true });
  },
  async writeText(path, data) {
    await writeFile(path, data, "utf8");
  },
};

/** Options for {@link init}. */
export interface InitOptions {
  /** When true, compute the plan but write nothing. Defaults to false. */
  dryRun?: boolean;
  /** Capabilities to compile; defaults to {@link DEFAULT_CAPABILITIES}. */
  capabilities?: InstallCapabilities;
  /** Absolute path to the bundled skills source dir (for copying SKILL.md). */
  skillsSourceDir?: string;
  /** Filesystem wrapper; defaults to {@link nodeInstallIo}. Injected in tests. */
  io?: InstallIo;
}

/** The outcome of {@link init}: the plan, and whether files were actually written. */
export interface InitResult {
  /** The planned files (same as {@link planInstall} would return). */
  plan: PlannedFile[];
  /** True if files were written to disk; false for a dry run. */
  written: boolean;
}

/**
 * Build the `path -> contents` write operations for `target`, deriving each
 * file's body from the shared definitions via the per-target emitters. Skill
 * files are read from `skillsSourceDir`. Pure aside from reading skill sources
 * through `io`.
 */
async function buildWrites(
  target: AgentTarget,
  plan: PlannedFile[],
  capabilities: InstallCapabilities,
  skillsSourceDir: string,
  io: InstallIo,
): Promise<Array<{ path: string; contents: string }>> {
  const writes: Array<{ path: string; contents: string }> = [];

  // Pre-compile the per-target config bodies once.
  const claudeAgents = target === "claude" ? emitClaudeAgents(capabilities.subagents) : [];

  for (const file of plan) {
    if (file.kind === "skill") {
      // Mirror the bundled SKILL.md. The skill name is the parent dir of SKILL.md.
      const skillName = basename(dirname(file.path));
      const source = await io.readText(join(skillsSourceDir, skillName, "SKILL.md"));
      writes.push({ path: file.path, contents: source });
      continue;
    }

    if (target === "claude") {
      if (file.kind === "hooks") {
        writes.push({
          path: file.path,
          contents: `${JSON.stringify(emitClaudeHooks(DEFAULT_HOOKS), null, 2)}\n`,
        });
      } else if (file.kind === "mcp") {
        writes.push({
          path: file.path,
          contents: `${JSON.stringify(emitClaudeMcp(DEFAULT_MCP_SERVERS), null, 2)}\n`,
        });
      } else if (file.kind === "agent") {
        const base = basename(file.path);
        const match = claudeAgents.find((a) => basename(a.path) === base);
        if (match) writes.push({ path: file.path, contents: match.contents });
      }
      continue;
    }

    // target === "codex": one config.toml carries hooks + mcp_servers + agents.
    if (file.kind === "hooks") {
      const body = [
        emitCodexHooks(DEFAULT_HOOKS),
        emitCodexMcp(DEFAULT_MCP_SERVERS),
        emitCodexAgents(capabilities.subagents),
      ].join("\n");
      writes.push({ path: file.path, contents: body });
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
    skillsSourceDir = join(process.cwd(), "skills"),
    io = nodeInstallIo,
  } = options;

  const plan = planInstall(target, repoPath, capabilities);

  if (dryRun) {
    return { plan, written: false };
  }

  const writes = await buildWrites(target, plan, capabilities, skillsSourceDir, io);
  for (const { path, contents } of writes) {
    await io.ensureDir(dirname(path));
    await io.writeText(path, contents);
  }

  return { plan, written: true };
}
