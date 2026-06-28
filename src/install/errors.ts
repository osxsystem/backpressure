/**
 * Typed, user-facing install errors. These are *expected* failures that the CLI
 * catches and surfaces as a single `backpressure: …` line with no stack trace.
 * Unexpected errors (genuine bugs) are never wrapped here and are allowed to
 * propagate so they surface with their full stack trace.
 */

/** Marker base for all expected, user-facing install failures. */
export class InstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallError";
  }
}

/**
 * Thrown when a required skill source (`SKILL.md`) is not found under the
 * configured skills source dir.
 */
export class MissingSkillSourceError extends InstallError {
  readonly skillName: string;
  readonly sourceDir: string;

  constructor(skillName: string, sourceDir: string) {
    super(`skill "${skillName}" not found in ${sourceDir}`);
    this.name = "MissingSkillSourceError";
    this.skillName = skillName;
    this.sourceDir = sourceDir;
  }
}

/**
 * Thrown when an opt-in skill name (via `--skill` / `--all-skills`) doesn't
 * match any bundled skill. The message lists what *is* available so the user
 * can correct a typo without digging through the source tree.
 */
export class UnknownSkillError extends InstallError {
  readonly skillName: string;
  readonly available: readonly string[];

  constructor(skillName: string, available: readonly string[]) {
    const list = available.length > 0 ? available.join(", ") : "(none)";
    super(`skill "${skillName}" is not bundled. Available: ${list}`);
    this.name = "UnknownSkillError";
    this.skillName = skillName;
    this.available = available;
  }
}

/**
 * Thrown when one or more skills in the resolved install set fail pre-install
 * validation (missing `SKILL.md`, invalid frontmatter, or a directory-name /
 * frontmatter-name mismatch). The install is **atomic** — nothing is written
 * when this is thrown. `problems` carries every failure so the user can fix
 * them all in one pass.
 */
export class SkillVerificationError extends InstallError {
  /** Every validation problem found across all checked skills. */
  readonly problems: readonly { skill: string; message: string }[];

  constructor(problems: { skill: string; message: string }[]) {
    const lines = problems.map((p) => ` - ${p.skill}: ${p.message}`).join("\n");
    super(`skill verification failed:\n${lines}`);
    this.name = "SkillVerificationError";
    this.problems = problems;
  }
}

/**
 * Returns true when `e` is a non-null object whose `code` property equals
 * `"ENOENT"`. Bridges raw fs errors to the typed {@link MissingSkillSourceError}.
 */
export function isEnoent(e: unknown): boolean {
  if (e === null || typeof e !== "object") return false;
  return (e as Record<string, unknown>).code === "ENOENT";
}

/**
 * Thrown when a pack's `backpressure.json` is missing, not valid JSON, or fails
 * schema validation. Carries a human message listing what's wrong.
 */
export class InvalidPackManifestError extends InstallError {
  constructor(message: string) {
    super(`invalid backpressure.json: ${message}`);
    this.name = "InvalidPackManifestError";
  }
}
