import { describe, expect, it } from "vitest";
import { Governor } from "../../src/loop/governor.js";

describe("Governor", () => {
  it("continues while under every limit", () => {
    const gov = new Governor({ maxIterations: 3, maxConsecutiveFailures: 2 });
    gov.record("success");
    expect(gov.decide().halt).toBe(false);
  });

  it("halts at the iteration cap", () => {
    const gov = new Governor({ maxIterations: 2, maxConsecutiveFailures: 5 });
    gov.record("success");
    expect(gov.decide().halt).toBe(false);
    gov.record("success");

    const decision = gov.decide();
    expect(decision.halt).toBe(true);
    expect(decision.reason).toContain("max iterations");
  });

  it("halts after N consecutive failures", () => {
    const gov = new Governor({ maxIterations: 10, maxConsecutiveFailures: 3 });
    gov.record("failure");
    gov.record("failure");
    expect(gov.decide().halt).toBe(false);
    gov.record("failure");

    const decision = gov.decide();
    expect(decision.halt).toBe(true);
    expect(decision.reason).toContain("consecutive failures");
  });

  it("resets the failure run on a success", () => {
    const gov = new Governor({ maxIterations: 10, maxConsecutiveFailures: 2 });
    gov.record("failure");
    gov.record("success");
    gov.record("failure");
    expect(gov.decide().halt).toBe(false);
  });

  it("halts when the optional budget cap is reached", () => {
    const gov = new Governor({ maxIterations: 10, maxConsecutiveFailures: 10, maxBudgetUsd: 1 });
    gov.record("success", 0.5);
    expect(gov.decide().halt).toBe(false);
    gov.record("success", 0.6);

    const decision = gov.decide();
    expect(decision.halt).toBe(true);
    expect(decision.reason).toContain("budget");
  });
});
