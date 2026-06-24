import { describe, expect, it } from "vitest";
import { buildArgv } from "../../src/seam/argv.js";
import { runAgent, type SpawnedProcess, type SpawnFn } from "../../src/seam/run.js";

/**
 * Build a fake spawn that records the command + args and fires `close` with the
 * given exit code on the next microtask, so `runAgent`'s promise resolves.
 */
function fakeSpawn(exitCode: number | null) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const spawn: SpawnFn = (command, args) => {
    calls.push({ command, args });
    const listeners: Record<string, (arg: number | null) => void> = {};
    const proc: SpawnedProcess = {
      on(event: string, listener: (arg: never) => void) {
        listeners[event] = listener as (arg: number | null) => void;
      },
    } as SpawnedProcess;
    queueMicrotask(() => listeners.close?.(exitCode));
    return proc;
  };
  return { spawn, calls };
}

describe("runAgent", () => {
  it("spawns the claude binary with the argv buildArgv produced", async () => {
    const { spawn, calls } = fakeSpawn(0);

    const code = await runAgent("claude", "do it", { spawn, model: "opus", maxTurns: 5 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("claude");
    expect(calls[0]?.args).toEqual(buildArgv("claude", "do it", { model: "opus", maxTurns: 5 }));
    expect(code).toBe(0);
  });

  it("spawns the codex binary with its argv", async () => {
    const { spawn, calls } = fakeSpawn(0);

    await runAgent("codex", "do it", { spawn });

    expect(calls[0]?.command).toBe("codex");
    expect(calls[0]?.args).toEqual(buildArgv("codex", "do it"));
  });

  it("parses and returns a non-zero exit code", async () => {
    const { spawn } = fakeSpawn(2);
    expect(await runAgent("claude", "boom", { spawn })).toBe(2);
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
});
