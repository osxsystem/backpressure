import { stringify } from "smol-toml";
import type { HookDefinition } from "../common/hooks.js";

/** One command-hook entry inside a Codex event group (mirrors Claude's). */
interface CodexCommandHook {
  type: "command";
  command: string;
}

/** A matcher group under an event: an optional tool matcher + its hooks. */
interface CodexMatcherGroup {
  matcher?: string;
  hooks: CodexCommandHook[];
}

/**
 * Compile shared {@link HookDefinition}s into a Codex `config.toml` fragment
 * string. Definitions are grouped by `event` into the NESTED shape Codex
 * 0.137.0 actually loads — `[[hooks.<Event>]]` + `[[hooks.<Event>.hooks]]`, each
 * inner entry carrying a mandatory `type = "command"` — mirroring the Claude
 * adapter so both compile the one shared {@link HookDefinition} in lock-step.
 *
 * The earlier flat top-level `[[hooks]]` array (`{event, matcher?, command}`
 * rows) was **silently ignored** by Codex, so the installed Stop gate never
 * fired and provided no backpressure. See `specs/codex-hooks.md`.
 *
 * Returns a TOML string (via `smol-toml`'s `stringify`) ready to merge into a
 * `config.toml`.
 */
export function emitCodexHooks(defs: HookDefinition[]): string {
  const hooks: Record<string, CodexMatcherGroup[]> = {};

  for (const def of defs) {
    const group: CodexMatcherGroup = {
      ...(def.matcher !== undefined ? { matcher: def.matcher } : {}),
      hooks: [{ type: "command", command: def.command }],
    };
    const existing = hooks[def.event];
    if (existing) {
      existing.push(group);
    } else {
      hooks[def.event] = [group];
    }
  }

  return stringify({ hooks });
}
