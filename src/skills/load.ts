import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/**
 * The validated frontmatter of a `SKILL.md`. Skills are portable across CLIs,
 * so the loader only depends on these scalar fields. `description` is required
 * — a skill the CLI can't describe can't be routed to, so it's rejected.
 */
export const SkillFrontmatterSchema = z.object({
  /** The skill's stable name. */
  name: z.string(),
  /** One-line summary the CLI uses to decide when to load the skill. */
  description: z.string(),
});

/** A loaded skill: just the fields parsed from its `SKILL.md` frontmatter. */
export type Skill = z.infer<typeof SkillFrontmatterSchema>;

/**
 * The slice of the filesystem the loader needs. Injectable so tests can point
 * it at a fixtures dir (or an in-memory fake) instead of the real disk.
 */
export interface SkillsIo {
  /** Names of the immediate subdirectories of `dir` (one per skill). */
  listDirs(dir: string): Promise<string[]>;
  /** Read a UTF-8 text file at `path`. */
  readText(path: string): Promise<string>;
}

/** Default {@link SkillsIo} backed by `node:fs/promises`. */
export const nodeSkillsIo: SkillsIo = {
  async listDirs(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  },
  async readText(path) {
    return readFile(path, "utf8");
  },
};

/**
 * Parse the leading `---`-fenced frontmatter block of a `SKILL.md` into a
 * record of scalar `key: value` pairs. Hand-rolled (the frontmatter here is
 * simple scalars only — no nested YAML). Throws if no fenced block is present.
 *
 * Only the first colon on a line splits key from value; surrounding whitespace
 * is trimmed. Blank lines inside the block are ignored.
 */
export function parseFrontmatter(source: string): Record<string, string> {
  const normalized = source.replace(/^﻿/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    throw new Error("SKILL.md is missing a '---' frontmatter block");
  }

  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key !== "") fields[key] = value;
  }
  return fields;
}

/**
 * Load every skill under `skillsDir`. Each immediate subdirectory is expected
 * to contain a `SKILL.md`; its frontmatter is parsed and validated against
 * {@link SkillFrontmatterSchema} (which requires `description`). A skill whose
 * frontmatter is missing `description` is rejected with an error naming it.
 *
 * All filesystem access goes through the injected {@link SkillsIo}, so this is
 * unit-testable against a fixtures dir.
 */
export async function loadSkills(skillsDir: string, io: SkillsIo = nodeSkillsIo): Promise<Skill[]> {
  const dirs = await io.listDirs(skillsDir);
  const skills: Skill[] = [];

  for (const dir of dirs) {
    const path = join(skillsDir, dir, "SKILL.md");
    const source = await io.readText(path);
    const fields = parseFrontmatter(source);
    const result = SkillFrontmatterSchema.safeParse(fields);
    if (!result.success) {
      throw new Error(`Invalid SKILL.md frontmatter in '${dir}': ${result.error.message}`);
    }
    skills.push(result.data);
  }

  return skills;
}
