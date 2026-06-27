import { describe, expect, it } from "vitest";
import { buildArgv } from "../../src/seam/argv.js";
import { parseCostUsd, runAgent, type SpawnedProcess, type SpawnFn } from "../../src/seam/run.js";

/**
 * A fake spawn that records command + args (+ the capture hint), optionally
 * feeds `stdoutData` to a captured stdout stream, then fires `close` with
 * `exitCode` on the next microtask so runAgent's promise resolves.
 */
function fakeSpawn(exitCode: number | null, stdoutData?: string) {
  const calls: Array<{ command: string; args: string[]; capture?: boolean }> = [];
  const spawn: SpawnFn = (command, args, opts) => {
    calls.push({ command, args, capture: opts?.capture });
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
  return { spawn, calls };
}

describe("runAgent", () => {
  it("spawns the claude binary with the argv buildArgv produced", async () => {
    const { spawn, calls } = fakeSpawn(0);

    const result = await runAgent("claude", "do it", { spawn, model: "opus", maxTurns: 5 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("claude");
    expect(calls[0]?.args).toEqual(buildArgv("claude", "do it", { model: "opus", maxTurns: 5 }));
    expect(result.exitCode).toBe(0);
  });

  it("spawns the codex binary with its argv", async () => {
    const { spawn, calls } = fakeSpawn(0);

    await runAgent("codex", "do it", { spawn });

    expect(calls[0]?.command).toBe("codex");
    expect(calls[0]?.args).toEqual(buildArgv("codex", "do it"));
  });

  it("@acceptance runAgent's RunResult preserves exit-code semantics with json off", async () => {
    expect((await runAgent("claude", "ok", { spawn: fakeSpawn(0).spawn })).exitCode).toBe(0);
    const boom = await runAgent("claude", "boom", { spawn: fakeSpawn(2).spawn });
    expect(boom.exitCode).toBe(2);
    expect(boom.costUsd).toBeUndefined();
  });

  it("rejects when the spawn errors", async () => {
    const spawn: SpawnFn = () => {
      const listeners: Record<string, (arg: unknown) => void> = {};
      const proc = {
        on(event: string, listener: (arg: unknown) => void) {
          listeners[event] = listener;
        },
      } as SpawnedProcess;
      queueMicrotask(() => listeners.error?.(new Error("ENOENT")));
      return proc;
    };

    await expect(runAgent("claude", "x", { spawn })).rejects.toThrow("ENOENT");
  });

  it("@acceptance runAgent surfaces costUsd from claude json stdout and undefined for codex", async () => {
    const claude = await runAgent("claude", "p", {
      json: true,
      spawn: fakeSpawn(0, '{"total_cost_usd":0.6}').spawn,
    });
    expect(claude).toEqual({ exitCode: 0, costUsd: 0.6 });

    // Codex passes --json but has no per-call USD figure (costPath null), so
    // even with stdout present the cost is not captured.
    const codex = await runAgent("codex", "p", {
      json: true,
      spawn: fakeSpawn(0, '{"total_cost_usd":0.6}').spawn,
    });
    expect(codex.exitCode).toBe(0);
    expect(codex.costUsd).toBeUndefined();
  });

  it("@acceptance runAgent pipes stdout only when cost is capturable (claude+json yes, codex+json no)", async () => {
    // Pins the capture guard: claude+json must capture (pipe), codex+json must
    // NOT (costPath null) — otherwise codex's --json stdout would be piped and
    // discarded, swallowing its terminal output.
    const claude = fakeSpawn(0, '{"total_cost_usd":0.6}');
    await runAgent("claude", "p", { json: true, spawn: claude.spawn });
    expect(claude.calls[0]?.capture).toBe(true);

    const codex = fakeSpawn(0, '{"total_cost_usd":0.6}');
    await runAgent("codex", "p", { json: true, spawn: codex.spawn });
    expect(codex.calls[0]?.capture).toBe(false);
  });

  it("@acceptance parseCostUsd returns undefined for garbage, empty, missing-field, and null-costPath", () => {
    expect(parseCostUsd("not json", "claude")).toBeUndefined();
    expect(parseCostUsd("", "claude")).toBeUndefined();
    expect(parseCostUsd('{"other":1}', "claude")).toBeUndefined();
    expect(parseCostUsd('{"total_cost_usd":"x"}', "claude")).toBeUndefined();
    expect(parseCostUsd('{"total_cost_usd":0.6}', "codex")).toBeUndefined();
  });
});
