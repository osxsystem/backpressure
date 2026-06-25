import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listSkillDirs, loadSkills, parseFrontmatter } from "../../src/skills/load.js";

describe("loadSkills", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bp-skills-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeSkill(name: string, frontmatter: string): Promise<void> {
    const skillDir = join(dir, name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), frontmatter, "utf8");
  }

  it("parses a fixture skill and returns its name + description", async () => {
    await writeSkill(
      "building-adaptive-ui",
      "---\nname: building-adaptive-ui\ndescription: Build UIs that adapt to theme tokens.\n---\n\n# Body\n",
    );

    const skills = await loadSkills(dir);
    expect(skills).toEqual([
      { name: "building-adaptive-ui", description: "Build UIs that adapt to theme tokens." },
    ]);
  });

  it("rejects a skill whose frontmatter is missing description", async () => {
    await writeSkill("broken", "---\nname: broken\n---\n\n# Body\n");

    await expect(loadSkills(dir)).rejects.toThrow(/broken/);
  });
});

describe("listSkillDirs", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bp-skilldirs-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns directory names that contain a SKILL.md and skips the rest", async () => {
    await mkdir(join(dir, "alpha"), { recursive: true });
    await writeFile(
      join(dir, "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: x\n---\n",
      "utf8",
    );
    await mkdir(join(dir, "beta"), { recursive: true });
    await writeFile(
      join(dir, "beta", "SKILL.md"),
      "---\nname: beta\ndescription: y\n---\n",
      "utf8",
    );
    // A non-skill folder (no SKILL.md) must not be reported.
    await mkdir(join(dir, "not-a-skill"), { recursive: true });

    const names = await listSkillDirs(dir);
    expect(names.sort()).toEqual(["alpha", "beta"]);
  });
});

describe("parseFrontmatter", () => {
  it("splits scalar key: value lines from the leading fenced block", () => {
    const fields = parseFrontmatter("---\nname: x\ndescription: a colon: inside\n---\nbody\n");
    expect(fields).toEqual({ name: "x", description: "a colon: inside" });
  });

  it("throws when there is no frontmatter block", () => {
    expect(() => parseFrontmatter("no frontmatter here")).toThrow(/frontmatter/);
  });
});
