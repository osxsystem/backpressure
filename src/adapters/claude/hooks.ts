import type { HookDefinition } from "../common/hooks.js";

/** A single command-hook entry inside a Claude matcher group. */
export interface ClaudeCommandHook {
  type: "command";
  command: string;
}

/** A matcher group under an event: an optional tool matcher + its hooks. */
export interface ClaudeMatcherGroup {
  matcher?: string;
  hooks: ClaudeCommandHook[];
}

/** The `settings.json` fragment Claude Code reads: hooks keyed by event name. */
export interface ClaudeHooksFragment {
  hooks: Record<string, ClaudeMatcherGroup[]>;
}

/**
 * Compile shared {@link HookDefinition}s into the Claude Code `settings.json`
 * `hooks` fragment. Definitions are grouped by `event`; each becomes a matcher
 * group ({@link ClaudeMatcherGroup}) carrying one `command` hook. A `matcher`
 * is emitted only when the definition has one (Stop-style gates omit it).
 *
 * Pure — returns a plain JS object the installer can `JSON.stringify`.
 */
export function emitClaudeHooks(defs: HookDefinition[]): ClaudeHooksFragment {
  const hooks: Record<string, ClaudeMatcherGroup[]> = {};

  for (const def of defs) {
    const group: ClaudeMatcherGroup = {
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

  return { hooks };
}
