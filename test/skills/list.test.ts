import { describe, expect, it } from "vitest";
import { formatSkills, listBundledSkills } from "../../src/skills/list.js";
import type { SkillsIo } from "../../src/skills/load.js";

/** A SKILL.md body with valid frontmatter. */
const skillMd = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`;

/**
 * Fake {@link SkillsIo} over an in-memory tree: each key is a subdirectory of the
 * skills dir; the value is its `SKILL.md` body, or `null` for a dir that has none.
 */
function fakeIo(tree: Record<string, string | null>): SkillsIo {
  return {
    async listDirs() {
      return Object.keys(tree);
    },
    async readText(path) {
      const parts = path.split("/");
      const dir = parts[parts.length - 2];
      const body = dir != null ? tree[dir] : undefined;
      if (body == null) throw new Error("ENOENT");
      return body;
    },
  };
}

describe("listBundledSkills (@acceptance)", () => {
  it("lists skill dirs with descriptions, marks defaults, sorts, and skips non-skill dirs", async () => {
    const io = fakeIo({
      "find-skills": skillMd("find-skills", "Discover skills"),
      "building-adaptive-ui": skillMd("building-adaptive-ui", "Adapt UI to themes"),
      "not-a-skill": null,
    });

    const skills = await listBundledSkills("/skills", ["building-adaptive-ui"], io);

    // Sorted by name; the dir without a SKILL.md is dropped.
    expect(skills.map((s) => s.name)).toEqual(["building-adaptive-ui", "find-skills"]);
    expect(skills.find((s) => s.name === "building-adaptive-ui")).toMatchObject({
      default: true,
      description: "Adapt UI to themes",
    });
    expect(skills.find((s) => s.name === "find-skills")).toMatchObject({
      default: false,
      description: "Discover skills",
    });
  });

  it("lists a SKILL.md with no frontmatter as empty-description instead of throwing", async () => {
    const io = fakeIo({ weird: "# no frontmatter here\n" });
    const skills = await listBundledSkills("/skills", [], io);
    expect(skills).toEqual([{ name: "weird", description: "", default: false }]);
  });
});

describe("formatSkills", () => {
  it("renders one line per skill, marks defaults with *, and names the opt-in flags", () => {
    const out = formatSkills([
      { name: "building-adaptive-ui", description: "Adapt UI", default: true },
      { name: "find-skills", description: "Discover", default: false },
    ]);
    expect(out).toContain("* building-adaptive-ui — Adapt UI");
    expect(out).toContain("  find-skills — Discover");
    expect(out).toContain("--all-skills");
  });

  it("handles the empty case", () => {
    expect(formatSkills([])).toBe("No bundled skills found.\n");
  });
});
