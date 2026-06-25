import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { emitCodexHooks } from "../../../src/adapters/codex/hooks.js";
import type { HookDefinition } from "../../../src/adapters/common/hooks.js";

describe("emitCodexHooks", () => {
  it("emits a TOML string that round-trips back to the hook fields", () => {
    const defs: HookDefinition[] = [
      { event: "Stop", command: "pnpm test" },
      { event: "PreToolUse", matcher: "Bash", command: "./scope-guard.sh" },
    ];

    const toml = emitCodexHooks(defs);
    expect(typeof toml).toBe("string");

    const parsed = parse(toml) as unknown as { hooks: HookDefinition[] };
    expect(parsed.hooks).toEqual([
      { event: "Stop", command: "pnpm test" },
      { event: "PreToolUse", matcher: "Bash", command: "./scope-guard.sh" },
    ]);
  });

  it("omits the matcher key when the definition has none", () => {
    const toml = emitCodexHooks([{ event: "Stop", command: "pnpm test" }]);
    const parsed = parse(toml) as unknown as { hooks: Array<Record<string, unknown>> };
    expect(parsed.hooks[0]).not.toHaveProperty("matcher");
    expect(parsed.hooks[0]?.event).toBe("Stop");
    expect(parsed.hooks[0]?.command).toBe("pnpm test");
  });
});
