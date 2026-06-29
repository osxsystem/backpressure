import { InstallError } from "../install/errors.js";
import type { PackManifest } from "./manifest.js";

/** Prompt seam: ask the user to confirm an install. */
export interface Prompter {
  confirm(summary: string): Promise<boolean>;
}

/**
 * Build the human-readable trust summary `add` shows before writing: the pinned
 * `source@sha`, then every hook command that will fire on a gate and every
 * executable script the pack installs — the third-party code that later runs on
 * the user's machine. Pure.
 */
export function summarizeTrust(manifest: PackManifest, source: string, sha: string): string {
  const lines = [
    `About to install ${source}@${sha}`,
    `  pack: ${manifest.name}@${manifest.version}`,
  ];
  const hooks = manifest.items.filter((i) => i.type === "hook");
  if (hooks.length) {
    lines.push("  hook commands (run on the Stop gate):");
    for (const h of hooks) lines.push(`    - ${(h as { command: string }).command}`);
  }
  if (manifest.scripts.length) {
    lines.push("  executable scripts:");
    for (const s of manifest.scripts) lines.push(`    - ${s}`);
  }
  return lines.join("\n");
}

/**
 * Show {@link summarizeTrust} and require confirmation, unless `opts.yes`. Throws
 * an {@link InstallError} when the user declines, so the caller writes nothing.
 */
export async function confirmInstall(
  manifest: PackManifest,
  source: string,
  sha: string,
  prompter: Prompter,
  opts: { yes?: boolean },
): Promise<void> {
  if (opts.yes) return;
  const ok = await prompter.confirm(summarizeTrust(manifest, source, sha));
  if (!ok) throw new InstallError("install declined.");
}
