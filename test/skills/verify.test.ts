import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifySkills } from "../../src/skills/verify.js";

describe("verifySkills", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bp-verify-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeSkill(name: string, content: string): Promise<void> {
    await mkdir(join(dir, name), { recursive: true });
    await writeFile(join(dir, name, "SKILL.md"), content, "utf8");
  }

  it("returns no problems for a valid skill", async () => {
    await writeSkill(
      "my-skill",
      "---\nname: my-skill\ndescription: A test skill.\n---\n\n# Body\n",
    );
    const problems = await verifySkills(dir, ["my-skill"]);
    expect(problems).toEqual([]);
  });

  it("records a problem when SKILL.md is missing", async () => {
    // No directory or file written for this skill.
    const problems = await verifySkills(dir, ["ghost-skill"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      skill: "ghost-skill",
      message: "SKILL.md not found",
    });
  });

  it("records a problem when frontmatter is missing description", async () => {
    await writeSkill("no-desc", "---\nname: no-desc\n---\n\n# Body\n");
    const problems = await verifySkills(dir, ["no-desc"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.skill).toBe("no-desc");
    expect(problems[0]?.message).toMatch(/invalid frontmatter/i);
  });

  it("records a problem when frontmatter has no --- block", async () => {
    await writeSkill("no-block", "# No frontmatter here\n");
    const problems = await verifySkills(dir, ["no-block"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.skill).toBe("no-block");
    expect(problems[0]?.message).toMatch(/frontmatter/i);
  });

  it("records a problem when directory name does not match frontmatter name", async () => {
    await writeSkill("dir-name", "---\nname: different-name\ndescription: Mismatched.\n---\n");
    const problems = await verifySkills(dir, ["dir-name"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.skill).toBe("dir-name");
    expect(problems[0]?.message).toContain("different-name");
    expect(problems[0]?.message).toContain("dir-name");
  });

  it("collects all problems across multiple bad skills without stopping early", async () => {
    // skill-a: missing SKILL.md
    // skill-b: bad frontmatter (no description)
    await writeSkill("skill-b", "---\nname: skill-b\n---\n");

    const problems = await verifySkills(dir, ["skill-a", "skill-b"]);
    expect(problems).toHaveLength(2);

    const skillNames = problems.map((p) => p.skill);
    expect(skillNames).toContain("skill-a");
    expect(skillNames).toContain("skill-b");
  });

  it("returns no problems when names is empty", async () => {
    const problems = await verifySkills(dir, []);
    expect(problems).toEqual([]);
  });

  it("accepts a custom SkillsIo", async () => {
    const fakeIo = {
      async listDirs(_: string): Promise<string[]> {
        return [];
      },
      async readText(path: string): Promise<string> {
        if (path.includes("injected-skill")) {
          return "---\nname: injected-skill\ndescription: From fake.\n---\n";
        }
        const e = new Error("ENOENT") as NodeJS.ErrnoException;
        e.code = "ENOENT";
        throw e;
      },
    };

    const problems = await verifySkills("/fake", ["injected-skill"], fakeIo);
    expect(problems).toEqual([]);
  });
});
