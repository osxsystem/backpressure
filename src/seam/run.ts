import { spawn as nodeSpawn } from "node:child_process";
import { type AgentOpts, buildArgv } from "./argv.js";
import { type AgentTarget, flagsFor } from "./targets.js";

/** The binary name to invoke for each target. */
const BINARIES: Record<AgentTarget, string> = {
  claude: "claude",
  codex: "codex",
};

/**
 * The minimal slice of a spawned child process {@link runAgent} relies on: an
 * `on("close", cb)` that eventually fires with the exit code, an `on("error")`,
 * and — only when output is captured (json mode) — a `stdout` stream emitting
 * `"data"` chunks. Kept narrow so tests can inject a trivial fake.
 */
export interface SpawnedProcess {
  on(event: "close", listener: (code: number | null) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  /** Present only when stdout is captured; emits the run's output chunks. */
  stdout?: { on(event: "data", listener: (chunk: unknown) => void): void } | null;
}

/**
 * The spawn function {@link runAgent} depends on. `opts.capture` asks the
 * implementation to pipe stdout (so the JSON cost line can be read) instead of
 * inheriting it. Injectable so tests can assert the command + argv — and feed
 * fake stdout — without launching a process.
 */
export type SpawnFn = (
  command: string,
  args: string[],
  opts?: { capture?: boolean },
) => SpawnedProcess;

/**
 * Default {@link SpawnFn} backed by `node:child_process` spawn. Inherits stdio
 * normally; when capturing, pipes stdout (`["inherit", "pipe", "inherit"]`) so
 * the end-of-run JSON is readable while stderr still streams through.
 */
export const nodeSpawnFn: SpawnFn = (command, args, opts) =>
  nodeSpawn(command, args, { stdio: opts?.capture ? ["inherit", "pipe", "inherit"] : "inherit" });

/** Options for {@link runAgent}: the invocation knobs plus an injectable spawn. */
export interface RunAgentOpts extends AgentOpts {
  /** Spawn implementation; defaults to {@link nodeSpawnFn}. Injected in tests. */
  spawn?: SpawnFn;
}

/** The outcome of one {@link runAgent} call. */
export interface RunResult {
  /** Process exit code, or `null` if killed by a signal with no code. */
  exitCode: number | null;
  /**
   * The run's USD cost, when captured (claude + `json: true`). `undefined` when
   * not requested, not supported (Codex has no per-call figure), or unparseable
   * — so an uncaptured cost defaults to 0 in the Governor without poisoning it.
   */
  costUsd?: number;
}

/**
 * Parse the run's USD cost from captured JSON `stdout` for `target`. Pure.
 * Returns `undefined` (never `0`/`NaN`/throw) when the target has no cost field
 * (`costPath === null`), the output is not JSON, or the field is missing or
 * non-numeric — so a failed capture is a typed signal, not a poisoned `0`.
 */
export function parseCostUsd(stdout: string, target: AgentTarget): number | undefined {
  const path = flagsFor(target).costPath;
  if (path === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const value = (parsed as Record<string, unknown>)[path];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Run an agent CLI headless on a single prompt. Resolves the binary and argv
 * for `target` (via {@link buildArgv}), spawns it through the injected
 * {@link SpawnFn}, and resolves a {@link RunResult} with the exit code and —
 * when `json: true` and the target reports cost — the captured `costUsd`.
 * Rejects if the spawn errors. All side effects go through `spawn`.
 */
export function runAgent(
  target: AgentTarget,
  prompt: string,
  opts: RunAgentOpts = {},
): Promise<RunResult> {
  const { spawn = nodeSpawnFn, ...agentOpts } = opts;
  const command = BINARIES[target];
  const args = buildArgv(target, prompt, agentOpts);
  // Capture (pipe) stdout only when the target reports a per-call cost (Claude).
  // Codex passes --json (forward-looking groundwork) but has no costPath in v0,
  // so its stdout stays inherited and costUsd is undefined — passing json:true to
  // Codex is inert for cost capture.
  const capture = agentOpts.json === true && flagsFor(target).costPath !== null;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { capture });
    let stdout = "";
    if (capture && child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      const costUsd = capture ? parseCostUsd(stdout, target) : undefined;
      resolve(costUsd === undefined ? { exitCode: code } : { exitCode: code, costUsd });
    });
  });
}
