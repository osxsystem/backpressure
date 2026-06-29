/** The pin written to `.backpressure/backpressure.lock` after a successful add. */
export interface PackLock {
  /** `owner/repo[/subdir]` the pack came from. */
  source: string;
  /** The ref the user asked for (branch/tag/sha, or the resolved default branch). */
  ref: string;
  /** The immutable commit SHA the install was pinned to. */
  sha: string;
}

/** Serialize a {@link PackLock} to its on-disk JSON text (trailing newline). */
export function serializeLock(lock: PackLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}
