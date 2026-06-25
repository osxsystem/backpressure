import { join } from "node:path";
import { nodeSkillsIo, parseFrontmatter, SkillFrontmatterSchema, type SkillsIo } from "./load.js";

/** True when `e` is a node fs error with code `"ENOENT"`. */
function isEnoent(e: unknown): boolean {
  if (e === null || typeof e !== "object") return false;
  return (e as Record<string, unknown>).code === "ENOENT";
}

/**
 * A single validation failure for one skill: which skill failed and why.
 * Returned (never thrown) so callers can collect all problems before deciding
 * whether to abort.
 */
export interface SkillProblem {
  /** The directory name (install identifier) of the failing skill. */
  skill: string;
  /** Human-readable description of what's wrong. */
  message: string;
}

/**
 * Validate each `name` in `names` against the skill source at
 * `<skillsSourceDir>/<name>/SKILL.md`. For every name the function checks:
 *
 * 1. The `SKILL.md` is readable (ENOENT → problem).
 * 2. The file has a valid `---` frontmatter block with `name` and `description`
 *    fields (parse/schema failure → problem).
 * 3. The frontmatter `name` matches the directory name (mismatch → problem).
 *
 * All problems across **all** names are collected (no early exit). An empty
 * return list means every name is valid and safe to install.
 *
 * This module intentionally has **no** `install/` imports — it returns pure
 * data and never throws (it has its own local {@link isEnoent} rather than
 * borrowing the installer's), so the skills layer stays independent of install.
 */
export async function verifySkills(
  skillsSourceDir: string,
  names: string[],
  io: SkillsIo = nodeSkillsIo,
): Promise<SkillProblem[]> {
  const problems: SkillProblem[] = [];

  for (const name of names) {
    const path = join(skillsSourceDir, name, "SKILL.md");

    let source: string;
    try {
      source = await io.readText(path);
    } catch (e) {
      if (isEnoent(e)) {
        problems.push({ skill: name, message: "SKILL.md not found" });
      } else {
        problems.push({ skill: name, message: `could not read SKILL.md: ${String(e)}` });
      }
      continue;
    }

    let fields: Record<string, string>;
    try {
      fields = parseFrontmatter(source);
    } catch {
      problems.push({ skill: name, message: "SKILL.md is missing a '---' frontmatter block" });
      continue;
    }

    const result = SkillFrontmatterSchema.safeParse(fields);
    if (!result.success) {
      problems.push({
        skill: name,
        message: `invalid frontmatter: ${result.error.issues.map((i) => i.message).join("; ")}`,
      });
      continue;
    }

    if (result.data.name !== name) {
      problems.push({
        skill: name,
        message: `frontmatter name "${result.data.name}" does not match directory name "${name}"`,
      });
    }
  }

  return problems;
}
