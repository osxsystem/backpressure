import { join } from "node:path";
import type { SubagentDefinition } from "../adapters/common/agents.js";
import type { AgentTarget } from "../seam/targets.js";
import { UnknownSkillError } from "./errors.js";

/**
 * The capabilities an install compiles into a repo. Authored once here (the
 * single source of truth), then {@link planInstall} maps them to each target's
 * native file layout. Kept minimal in v0: the bundled skills and the subagents.
 */
export interface InstallCapabilities {
  /** Subagent definitions to compile (one file each on Claude). */
  subagents: SubagentDefinition[];
  /** Names of bundled skill directories to install. */
  skills: string[];
}

/** The default v0 capability set: the reviewer subagent + the bundled skill. */
export const DEFAULT_CAPABILITIES: InstallCapabilities = {
  subagents: [
    {
      name: "reviewer",
      description: "Reviews a diff for scope creep and missing tests.",
      prompt: "You are a careful code reviewer. Report only concrete issues.",
      tools: ["Read", "Grep"],
    },
  ],
  skills: ["building-adaptive-ui"],
};

/**
 * Decide which bundled skills an install should write, given the set
 * `available` (discovered under the skills dir) and the user's opt-ins. Pure.
 *
 * - `all: true` installs every discovered skill.
 * - otherwise the default set ({@link DEFAULT_CAPABILITIES}) plus any `extra`
 *   names the user opted into, de-duplicated and order-preserving.
 *
 * Every opt-in name is validated against `available`; an unknown one throws
 * {@link UnknownSkillError} (so a typo fails cleanly instead of later as a
 * missing-source error). Default skills are trusted and not re-validated — a
 * broken default is a packaging bug, not user input.
 */
export function resolveInstalledSkills(
  available: readonly string[],
  opts: { extra?: readonly string[]; all?: boolean } = {},
): string[] {
  if (opts.all) return [...available];

  const extra = opts.extra ?? [];
  for (const name of extra) {
    if (!available.includes(name)) throw new UnknownSkillError(name, available);
  }
  return [...new Set([...DEFAULT_CAPABILITIES.skills, ...extra])];
}

/** One planned file: where to write it and what kind of artifact it is. */
export interface PlannedFile {
  /** Absolute path under `repoPath`. */
  path: string;
  /** What this file is, so {@link planInstall} callers can branch if needed. */
  kind: "hooks" | "mcp" | "agent" | "skill";
}

/**
 * Compute the list of files an install would write for `target` into
 * `repoPath`, given a capability set. Pure — performs NO I/O; it only joins
 * paths. The actual emit + write happens in the installer (a later task).
 *
 * Claude Code uses JSON split across files (`.claude/settings.json` for hooks,
 * `.claude/agents/<name>.md` per subagent, `.mcp.json`, and a skill dir per
 * bundled skill under `.claude/skills/`). Codex uses a single `config.toml`
 * (hooks + mcp_servers + agents together) plus a skill dir per skill under
 * `.codex/skills/`.
 */
export function planInstall(
  target: AgentTarget,
  repoPath: string,
  capabilities: InstallCapabilities = DEFAULT_CAPABILITIES,
): PlannedFile[] {
  const abs = (...segments: string[]): string => join(repoPath, ...segments);
  const files: PlannedFile[] = [];

  if (target === "claude") {
    files.push({ path: abs(".claude", "settings.json"), kind: "hooks" });
    files.push({ path: abs(".mcp.json"), kind: "mcp" });
    for (const agent of capabilities.subagents) {
      files.push({ path: abs(".claude", "agents", `${agent.name}.md`), kind: "agent" });
    }
    for (const skill of capabilities.skills) {
      files.push({ path: abs(".claude", "skills", skill, "SKILL.md"), kind: "skill" });
    }
    return files;
  }

  // target === "codex": hooks, mcp_servers, and agents all live in config.toml.
  files.push({ path: abs(".codex", "config.toml"), kind: "hooks" });
  for (const skill of capabilities.skills) {
    files.push({ path: abs(".codex", "skills", skill, "SKILL.md"), kind: "skill" });
  }
  return files;
}
