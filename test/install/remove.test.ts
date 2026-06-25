import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planInstall } from "../../src/install/plan.js";
import type { RemoveIo } from "../../src/install/remove.js";
import { remove } from "../../src/install/remove.js";

/** Resolve the install dir for a given skill + target via planInstall. */
function skillInstallDir(target: "claude" | "codex", baseDir: string, name: string): string {
  const planned = planInstall(target, baseDir, { subagents: [], skills: [name] });
  const entry = planned.filter((f) => f.kind === "skill")[0];
  if (!entry) throw new Error(`planInstall returned no skill entry for "${name}"`);
  return dirname(entry.path);
}

describe("remove", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bp-remove-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Helper: create a minimal valid skill dir inside `dir`. */
  async function plantSkill(target: "claude" | "codex", name: string): Promise<string> {
    const skillDir = skillInstallDir(target, dir, name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: test\n---\n`,
      "utf8",
    );
    return skillDir;
  }

  it("removes an installed skill directory", async () => {
    const skillDir = await plantSkill("claude", "my-skill");

    const result = await remove("claude", dir, { skills: ["my-skill"] });

    expect(result.removed).toBe(true);
    expect(result.actions).toEqual([{ skill: "my-skill", path: skillDir, action: "removed" }]);
    // Directory must no longer exist.
    await expect(access(skillDir)).rejects.toThrow();
  });

  it("records skipped-not-installed when the skill dir is absent", async () => {
    const result = await remove("claude", dir, { skills: ["never-installed"] });

    expect(result.removed).toBe(false);
    expect(result.actions[0]).toMatchObject({
      skill: "never-installed",
      action: "skipped-not-installed",
    });
  });

  it("records refused-not-skill when the dir exists but has no SKILL.md", async () => {
    // Create the dir without a SKILL.md.
    const skillDir = skillInstallDir("claude", dir, "orphan");
    await mkdir(skillDir, { recursive: true });

    const result = await remove("claude", dir, { skills: ["orphan"] });

    expect(result.removed).toBe(false);
    expect(result.actions[0]).toMatchObject({
      skill: "orphan",
      path: skillDir,
      action: "refused-not-skill",
    });
    // Dir must still exist.
    await expect(access(skillDir)).resolves.toBeUndefined();
  });

  it("dry-run reports removed actions without deleting anything", async () => {
    const skillDir = await plantSkill("claude", "dry-skill");

    const result = await remove("claude", dir, { skills: ["dry-skill"], dryRun: true });

    expect(result.removed).toBe(true);
    expect(result.actions[0]).toMatchObject({ skill: "dry-skill", action: "removed" });
    // Dir must still exist (dry run — nothing written).
    await expect(access(skillDir)).resolves.toBeUndefined();
  });

  it("uses the codex target path for codex installs", async () => {
    const skillDir = await plantSkill("codex", "codex-skill");

    const result = await remove("codex", dir, { skills: ["codex-skill"] });

    expect(result.removed).toBe(true);
    // The path should be under .codex/skills, not .claude/skills.
    expect(result.actions[0]?.path).toContain(".codex");
    await expect(access(skillDir)).rejects.toThrow();
  });

  it("handles multiple skills in one call", async () => {
    await plantSkill("claude", "skill-a");
    // skill-b is deliberately not installed.

    const result = await remove("claude", dir, { skills: ["skill-a", "skill-b"] });

    const bySkill = Object.fromEntries(result.actions.map((a) => [a.skill, a.action]));
    expect(bySkill["skill-a"]).toBe("removed");
    expect(bySkill["skill-b"]).toBe("skipped-not-installed");
    expect(result.removed).toBe(true);
  });

  it("accepts a custom RemoveIo", async () => {
    const removed: string[] = [];
    const io: RemoveIo = {
      async pathExists(p) {
        return p.includes("exists");
      },
      async fileExists(p) {
        return p.includes("exists");
      },
      async removeDir(p) {
        removed.push(p);
      },
    };

    const skillDir = skillInstallDir("claude", dir, "exists-skill");
    const result = await remove("claude", dir, { skills: ["exists-skill"], io });

    expect(result.actions[0]?.action).toBe("removed");
    expect(removed).toContain(skillDir);
  });

  it("derives the path via planInstall so path logic stays single-sourced", () => {
    // Verify the derived path matches what planInstall emits for the same target.
    const expected = skillInstallDir("claude", dir, "test-skill");
    expect(expected).toBe(join(dir, ".claude", "skills", "test-skill"));
  });
});
