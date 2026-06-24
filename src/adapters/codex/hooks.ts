import { stringify } from "smol-toml";
import type { HookDefinition } from "../common/hooks.js";

/** One hook table as it appears under `[[hooks]]` in Codex's `config.toml`. */
interface CodexHookTable {
  event: string;
  matcher?: string;
  command: string;
}

/**
 * Compile shared {@link HookDefinition}s into a Codex `config.toml` fragment
 * string. Each definition becomes a `[[hooks]]` array-of-tables entry carrying
 * its `event`, optional `matcher`, and `command`. The same {@link HookDefinition}
 * type drives the Claude emitter, so the two stay in lock-step.
 *
 * Returns a TOML string (via `smol-toml`'s `stringify`) ready to merge into a
 * `config.toml`.
 */
export function emitCodexHooks(defs: HookDefinition[]): string {
  const hooks: CodexHookTable[] = defs.map((def) => ({
    event: def.event,
    ...(def.matcher !== undefined ? { matcher: def.matcher } : {}),
    command: def.command,
  }));

  return stringify({ hooks });
}
