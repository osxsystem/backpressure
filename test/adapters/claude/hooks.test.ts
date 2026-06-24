import { describe, expect, it } from "vitest";
import { emitClaudeHooks } from "../../../src/adapters/claude/hooks.js";
import type { HookDefinition } from "../../../src/adapters/common/hooks.js";

describe("emitClaudeHooks", () => {
  it("emits a Stop test-gate hook with no matcher", () => {
    const defs: HookDefinition[] = [{ event: "Stop", command: "npm test" }];

    expect(emitClaudeHooks(defs)).toEqual({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "npm test" }] }],
      },
    });
  });

  it("emits a PreToolUse scope-guard hook with a matcher", () => {
    const defs: HookDefinition[] = [
      { event: "PreToolUse", matcher: "Bash", command: "./scope-guard.sh" },
    ];

    expect(emitClaudeHooks(defs)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "./scope-guard.sh" }],
          },
        ],
      },
    });
  });

  it("groups multiple definitions by event", () => {
    const defs: HookDefinition[] = [
      { event: "PreToolUse", matcher: "Bash", command: "a" },
      { event: "PreToolUse", matcher: "Write", command: "b" },
      { event: "Stop", command: "npm test" },
    ];

    const fragment = emitClaudeHooks(defs);
    expect(fragment.hooks.PreToolUse).toHaveLength(2);
    expect(fragment.hooks.Stop).toHaveLength(1);
  });
});
