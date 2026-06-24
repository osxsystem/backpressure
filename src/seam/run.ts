import { spawn as nodeSpawn } from "node:child_process";
import { type AgentOpts, buildArgv } from "./argv.js";
import type { AgentTarget } from "./targets.js";

/** The binary name to invoke for each target. */
const BINARIES: Record<AgentTarget, string> = {
  claude: "claude",
  codex: "codex",
};

/**
 * The minimal slice of a spawned child process {@link runAgent} relies on:
 * an `on("close", cb)` that eventually fires with the exit code. Kept narrow
 * so tests can inject a trivial fake instead of a real process.
 */
export interface SpawnedProcess {
  on(event: "close", listener: (code: number | null) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

/**
 * The spawn function {@link runAgent} depends on. Mirrors the shape of
 * `node:child_process` spawn that we use, but injectable so tests can assert
 * the command + argv without launching a process.
 */
export type SpawnFn = (command: string, args: string[]) => SpawnedProcess;

/** Default {@link SpawnFn} backed by `node:child_process` spawn (inherits stdio). */
export const nodeSpawnFn: SpawnFn = (command, args) =>
  nodeSpawn(command, args, { stdio: "inherit" });

/** Options for {@link runAgent}: the invocation knobs plus an injectable spawn. */
export interface RunAgentOpts extends AgentOpts {
  /** Spawn implementation; defaults to {@link nodeSpawnFn}. Injected in tests. */
  spawn?: SpawnFn;
}

/**
 * Run an agent CLI headless on a single prompt. Resolves the binary and argv
 * for `target` (via {@link buildArgv}), spawns it through the injected
 * {@link SpawnFn}, and resolves with the process exit code (`null` if the
 * process was killed by a signal with no code). Rejects if the spawn errors.
 *
 * All side effects go through `spawn`, so the core wiring is unit-testable.
 */
export function runAgent(
  target: AgentTarget,
  prompt: string,
  opts: RunAgentOpts = {},
): Promise<number | null> {
  const { spawn = nodeSpawnFn, ...agentOpts } = opts;
  const command = BINARIES[target];
  const args = buildArgv(target, prompt, agentOpts);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}
