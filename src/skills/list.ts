import { join } from "node:path";
import { nodeSkillsIo, parseFrontmatter, type SkillsIo } from "./load.js";

/** A bundled skill the CLI can offer to install, plus enough to describe it. */
export interface BundledSkill {
  /** The skill's directory name — the install identifier used by `--skill <name>`. */
  name: string;
  /** One-line summary from `SKILL.md` frontmatter; `""` when absent/unparseable. */
  description: string;
  /** True when the skill is part of the default install set. */
  default: boolean;
}

/**
 * List the bundled skills available to install under `skillsDir`, pairing each
 * with its `SKILL.md` description and whether it's a default (membership in the
 * caller-supplied `defaults`, so this module never depends on the install layer).
 *
 * Mirrors {@link listSkillDirs}'s tolerance: a subdirectory without a readable
 * `SKILL.md` is skipped (not a skill), and a `SKILL.md` lacking frontmatter is
 * listed with an empty description rather than throwing — discovery should never
 * crash because one folder is malformed. Sorted by name for deterministic output.
 * All I/O goes through the injectable {@link SkillsIo}.
 */
export async function listBundledSkills(
  skillsDir: string,
  defaults: readonly string[],
  io: SkillsIo = nodeSkillsIo,
): Promise<BundledSkill[]> {
  const dirs = await io.listDirs(skillsDir);
  const skills: BundledSkill[] = [];

  for (const name of dirs) {
    let source: string;
    try {
      source = await io.readText(join(skillsDir, name, "SKILL.md"));
    } catch {
      continue; // No readable SKILL.md here — not a skill dir, so skip it.
    }

    let description = "";
    try {
      description = parseFrontmatter(source).description ?? "";
    } catch {
      // SKILL.md without a frontmatter block — list it with no description.
    }

    skills.push({ name, description, default: defaults.includes(name) });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Render bundled skills for `backpressure skills list`: one line per skill,
 * a leading `*` marking the defaults, then a footer naming the opt-in flags.
 * Pure; ends in a newline so it composes with `process.stdout.write`.
 */
export function formatSkills(skills: readonly BundledSkill[]): string {
  if (skills.length === 0) return "No bundled skills found.\n";

  const lines = skills.map((s) => {
    const tag = s.default ? "*" : " ";
    const desc = s.description ? ` — ${s.description}` : "";
    return `${tag} ${s.name}${desc}`;
  });

  return `${lines.join("\n")}\n\n* installed by default · others via --skill <name> or --all-skills\n`;
}
