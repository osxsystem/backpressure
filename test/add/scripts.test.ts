import { describe, expect, it } from "vitest";
import { rewriteScriptRefs } from "../../src/add/scripts.js";

describe("rewriteScriptRefs", () => {
  it("rewrites a declared script reference to the installed path", () => {
    expect(
      rewriteScriptRefs("./scripts/backpressure-gate.sh", ["scripts/backpressure-gate.sh"]),
    ).toBe("./.backpressure/scripts/backpressure-gate.sh");
    expect(
      rewriteScriptRefs("scripts/backpressure-gate.sh --x", ["scripts/backpressure-gate.sh"]),
    ).toBe(".backpressure/scripts/backpressure-gate.sh --x");
  });

  it("leaves commands with no declared-script reference untouched", () => {
    expect(rewriteScriptRefs("pnpm test", ["scripts/backpressure-gate.sh"])).toBe("pnpm test");
  });
});
