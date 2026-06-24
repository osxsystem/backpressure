import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { init } from "../../src/install/init.js";
import { planInstall } from "../../src/install/plan.js";

// The bundled skills dir at <repoRoot>/skills, two levels up from this file.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillsSourceDir = join(repoRoot, "skills");

describe("init", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bp-init-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("dry-run writes nothing and returns the plan", async () => {
    const result = await init("claude", dir, { dryRun: true, skillsSourceDir });

    expect(result.written).toBe(false);
    expect(result.plan).toEqual(planInstall("claude", dir));

    // Nothing was created in the temp dir.
    const entries = await readdir(dir);
    expect(entries).toEqual([]);
  });

  it("real-run writes the planned Claude files to disk", async () => {
    const result = await init("claude", dir, { skillsSourceDir });

    expect(result.written).toBe(true);
    for (const file of result.plan) {
      await expect(access(file.path)).resolves.toBeUndefined();
    }

    // The hooks file is valid JSON with the Stop test-gate.
    const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
    expect(settings.hooks.Stop).toBeDefined();

    // The bundled skill's SKILL.md was copied through.
    const skillMd = await readFile(
      join(dir, ".claude", "skills", "building-adaptive-ui", "SKILL.md"),
      "utf8",
    );
    expect(skillMd).toContain("name: building-adaptive-ui");
  });

  it("real-run writes the Codex config.toml to disk", async () => {
    const result = await init("codex", dir, { skillsSourceDir });

    expect(result.written).toBe(true);
    await expect(access(join(dir, ".codex", "config.toml"))).resolves.toBeUndefined();
    await expect(
      access(join(dir, ".codex", "skills", "building-adaptive-ui", "SKILL.md")),
    ).resolves.toBeUndefined();
  });
});
