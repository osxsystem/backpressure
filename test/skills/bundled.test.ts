import { access, constants } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSkills } from "../../src/skills/load.js";

// The bundled skills live at <repoRoot>/skills; this test file is at
// <repoRoot>/test/skills/, so the repo root is two levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillsDir = join(repoRoot, "skills");

describe("bundled building-adaptive-ui skill", () => {
  it("is found by the loader and its frontmatter validates", async () => {
    const skills = await loadSkills(skillsDir);
    const adaptive = skills.find((s) => s.name === "building-adaptive-ui");

    expect(adaptive).toBeDefined();
    expect(adaptive?.description).toMatch(/token/i);
  });

  it("ships an executable check-hardcoded-colors.sh script", async () => {
    const script = join(skillsDir, "building-adaptive-ui", "scripts", "check-hardcoded-colors.sh");
    await expect(access(script, constants.X_OK)).resolves.toBeUndefined();
  });
});
