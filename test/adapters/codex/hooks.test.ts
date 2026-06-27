import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { emitCodexHooks } from "../../../src/adapters/codex/hooks.js";
import type { HookDefinition } from "../../../src/adapters/common/hooks.js";

/**
 * Codex 0.137.0 ignores a flat top-level `[[hooks]]` array, so the gate must be
 * emitted as nested `[[hooks.<Event>]]` + `[[hooks.<Event>.hooks]]` tables. The
 * `Array.isArray(parsed.hooks) === false` assertion is the tripwire that stops a
 * future amnesiac loop from flattening it back. See specs/codex-hooks.md.
 */
type ParsedCodexHooks = {
  hooks: Record<
    string,
    Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>
  >;
};

const parseHooks = (toml: string) => parse(toml) as unknown as ParsedCodexHooks;

describe("emitCodexHooks", () => {
  it("@acceptance emitCodexHooks emits hooks.Stop nested, not a flat top-level hooks array", () => {
    const parsed = parseHooks(emitCodexHooks([{ event: "Stop", command: "pnpm test" }]));
    expect(Array.isArray(parsed.hooks)).toBe(false);
    expect(Array.isArray(parsed.hooks.Stop)).toBe(true);
  });

  it("@acceptance emitCodexHooks types every inner Stop hook as type=command", () => {
    const parsed = parseHooks(emitCodexHooks([{ event: "Stop", command: "pnpm test" }]));
    expect(parsed.hooks.Stop?.[0]?.hooks[0]).toEqual({ type: "command", command: "pnpm test" });
  });

  it("@acceptance emitCodexHooks groups two same-event definitions under one hooks.Stop array", () => {
    const defs: HookDefinition[] = [
      { event: "Stop", command: "a" },
      { event: "Stop", command: "b" },
    ];
    const parsed = parseHooks(emitCodexHooks(defs));
    expect(parsed.hooks.Stop?.length).toBe(2);
    expect(parsed.hooks.Stop?.[0]?.hooks[0]?.command).toBe("a");
    expect(parsed.hooks.Stop?.[1]?.hooks[0]?.command).toBe("b");
  });

  it("@acceptance emitCodexHooks omits matcher when absent and preserves it on the outer group", () => {
    const defs: HookDefinition[] = [
      { event: "Stop", command: "pnpm test" },
      { event: "PreToolUse", matcher: "Bash", command: "./scope-guard.sh" },
    ];
    const parsed = parseHooks(emitCodexHooks(defs));
    expect(parsed.hooks.Stop?.[0]).not.toHaveProperty("matcher");
    expect(parsed.hooks.PreToolUse?.[0]?.matcher).toBe("Bash");
  });
});
