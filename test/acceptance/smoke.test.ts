import type commander from "commander";
import { describe, expect, it } from "vitest";
import { buildProgram } from "../../src/cli.js";

/**
 * The `@acceptance` suite is the gate's only POSITIVE done-signal
 * (scripts/backpressure-gate.sh stage 6 runs `vitest run -t @acceptance`).
 * Tests opt in by carrying the literal `@acceptance` tag in their title.
 *
 * This is the seed: a single always-green smoke test so the acceptance stage
 * asserts something real at the planning baseline. Each fix_plan item adds its
 * own `@acceptance` test(s) alongside its implementation, growing this suite
 * green item-by-item. DO NOT pre-author failing `@acceptance` tests for
 * not-yet-built items — a red acceptance stage deadlocks the one-thing-per-loop
 * gate (see specs/overview.md "Acceptance discipline").
 */
describe("acceptance smoke", () => {
  it("@acceptance the backpressure CLI registers init, remove, build, index", () => {
    const names = buildProgram().commands.map((c: commander.Command) => c.name());
    expect(names).toEqual(expect.arrayContaining(["init", "remove", "build", "index"]));
  });
});
