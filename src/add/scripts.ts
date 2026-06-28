import { basename } from "node:path";

/**
 * Rewrite references to declared pack scripts inside a hook `command` so they
 * point at where the installer puts them (`.backpressure/scripts/<basename>`).
 * Each script's manifest-relative path (e.g. `scripts/gate.sh`) is replaced with
 * `.backpressure/scripts/<basename>`; a leading `./` is preserved. Pure string op.
 */
export function rewriteScriptRefs(command: string, scripts: string[]): string {
  let out = command;
  for (const s of scripts) {
    const installed = `.backpressure/scripts/${basename(s)}`;
    // Single pass is sufficient: a leading "./" is preserved because
    // `"./x".split("x")` → `["./", ""]`, so join re-attaches the prefix.
    out = out.split(s).join(installed);
  }
  return out;
}
