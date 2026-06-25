import { access, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentTarget } from "../seam/targets.js";
import { planInstall } from "./plan.js";

/**
 * The slice of the filesystem {@link remove} needs. Injectable so tests can
 * use an in-memory fake without touching disk.
 */
export interface RemoveIo {
  /** True when the path exists as a directory. */
  pathExists(p: string): Promise<boolean>;
  /** True when the path exists as a regular file. */
  fileExists(p: string): Promise<boolean>;
  /** Remove the directory at `p` and all of its contents. */
  removeDir(p: string): Promise<void>;
}

/** Default {@link RemoveIo} backed by `node:fs/promises`. */
export const nodeRemoveIo: RemoveIo = {
  async pathExists(p) {
    try {
      const s = await stat(p);
      return s.isDirectory();
    } catch {
      return false;
    }
  },
  async fileExists(p) {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  },
  async removeDir(p) {
    await rm(p, { recursive: true, force: true });
  },
};

/** What happened to each skill during a {@link remove} call. */
export type RemoveAction = {
  /** The skill's directory name (install identifier). */
  skill: string;
  /** The absolute path of the skill's install directory. */
  path: string;
  /** `removed` — the dir was deleted (or would be in a dry run).
   *  `skipped-not-installed` — the dir was never there.
   *  `refused-not-skill` — the dir exists but has no `SKILL.md` inside, so we
   *  refuse to delete it (safety guard against removing user files). */
  action: "removed" | "skipped-not-installed" | "refused-not-skill";
};

/** The outcome of {@link remove}. */
export interface RemoveResult {
  /** One entry per skill requested. */
  actions: RemoveAction[];
  /** True when at least one skill was removed (or would be in a dry run). */
  removed: boolean;
}

/** Options for {@link remove}. */
export interface RemoveOptions {
  /** When true, compute which actions would be taken but write nothing. */
  dryRun?: boolean;
  /** Directory names of the skills to remove (install identifiers). */
  skills: string[];
  /** Filesystem wrapper; defaults to {@link nodeRemoveIo}. Injected in tests. */
  io?: RemoveIo;
}

/**
 * Remove previously-installed Backpressure skills from `baseDir` for `target`.
 *
 * For each skill name the install path is derived by consulting
 * {@link planInstall} so path logic stays single-sourced there. The function
 * then:
 *
 * - If the skill directory does not exist → `skipped-not-installed` (nothing to do).
 * - If it exists but contains no `SKILL.md` → `refused-not-skill` (safety
 *   guard: we won't delete a directory we didn't create).
 * - Otherwise → delete it (unless `dryRun`) and record `removed`.
 *
 * Returns the full action list and a convenience `removed` boolean.
 */
export async function remove(
  target: AgentTarget,
  baseDir: string,
  options: RemoveOptions,
): Promise<RemoveResult> {
  const { dryRun = false, skills, io = nodeRemoveIo } = options;
  const actions: RemoveAction[] = [];

  for (const skill of skills) {
    // planInstall emits the SKILL.md path; dirname() gives us the skill root dir.
    // planInstall always emits a skill entry when capabilities.skills is non-empty,
    // so the find is always defined — guarded with a filter to satisfy the linter.
    const planned = planInstall(target, baseDir, { subagents: [], skills: [skill] });
    const [skillEntry] = planned.filter((f) => f.kind === "skill");
    if (!skillEntry) continue; // unreachable in practice — planInstall always emits one
    const skillDir = dirname(skillEntry.path);

    if (!(await io.pathExists(skillDir))) {
      actions.push({ skill, path: skillDir, action: "skipped-not-installed" });
      continue;
    }

    const hasMd = await io.fileExists(join(skillDir, "SKILL.md"));
    if (!hasMd) {
      actions.push({ skill, path: skillDir, action: "refused-not-skill" });
      continue;
    }

    if (!dryRun) {
      await io.removeDir(skillDir);
    }
    actions.push({ skill, path: skillDir, action: "removed" });
  }

  return {
    actions,
    removed: actions.some((a) => a.action === "removed"),
  };
}
