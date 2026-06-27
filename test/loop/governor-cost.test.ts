import { describe, expect, it } from "vitest";
import { Governor } from "../../src/loop/governor.js";
import { runAgent, type SpawnedProcess, type SpawnFn } from "../../src/seam/run.js";

/** A fake spawn that optionally feeds captured stdout, then closes with `exitCode`. */
function fakeSpawn(exitCode: number | null, stdoutData?: string): SpawnFn {
  return (_command, _args, opts) => {
    const closeCbs: Array<(c: number | null) => void> = [];
    const dataCbs: Array<(c: unknown) => void> = [];
    const proc = {
      on(event: string, listener: (arg: never) => void) {
        if (event === "close") closeCbs.push(listener as (c: number | null) => void);
      },
      stdout: opts?.capture
        ? {
            on(_event: string, listener: (chunk: never) => void) {
              dataCbs.push(listener as (c: unknown) => void);
            },
          }
        : undefined,
    } as SpawnedProcess;
    queueMicrotask(() => {
      if (stdoutData !== undefined) for (const cb of dataCbs) cb(stdoutData);
      for (const cb of closeCbs) cb(exitCode);
    });
    return proc;
  };
}

describe("governor + runAgent cost wiring", () => {
  it("@acceptance governor halts on real captured cost fed through the seam", async () => {
    const gov = new Governor({ maxIterations: 10, maxConsecutiveFailures: 10, maxBudgetUsd: 1 });
    for (let i = 0; i < 2; i++) {
      const result = await runAgent("claude", "p", {
        json: true,
        spawn: fakeSpawn(0, '{"total_cost_usd":0.6}'),
      });
      gov.record("success", result.costUsd); // 0.6 captured each iteration
    }
    const decision = gov.decide();
    expect(decision.halt).toBe(true); // 1.2 >= budget 1
    expect(decision.reason).toContain("budget");
  });

  it("@acceptance json-omitted cost defaults to 0 and does not arm the budget cap", async () => {
    const gov = new Governor({ maxIterations: 10, maxConsecutiveFailures: 10, maxBudgetUsd: 1 });
    for (let i = 0; i < 2; i++) {
      const result = await runAgent("claude", "p", { spawn: fakeSpawn(0) }); // json omitted
      gov.record("success", result.costUsd); // undefined -> Governor defaults to 0
    }
    expect(gov.decide().halt).toBe(false);
  });
});
