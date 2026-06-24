import { describe, expect, it } from "vitest";

// Placeholder smoke test proving the toolchain (vitest + TypeScript) runs.
// Real tests arrive alongside the modules they cover (see PLAN.md).
describe("smoke", () => {
  it("runs a passing placeholder test", () => {
    expect(1 + 1).toBe(2);
  });
});
