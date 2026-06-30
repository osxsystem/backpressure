// src/install/with-loop.ts
import { join } from "node:path";
import { installPack } from "../add/install-pack.js";
import type { AgentTarget } from "../seam/targets.js";
import { InstallError } from "./errors.js";
import { writeTunedGate } from "./gate.js";
import { bundledPacksDir, type InstallIo, init, nodeInstallIo } from "./init.js";
import type { StackProfile } from "./stack.js";

/**
 * Install the default capabilities (with init's own Stop hook suppressed) plus the
 * BUNDLED loop pack (network-free, via {@link installPack}), then retune the gate
 * to the detected stack. The loop pack supplies the sole `Stop` hook (the gate).
 *
 * Codex is rejected early (before any files are written) as a clean InstallError.
 */
export async function installWithLoop(
  target: AgentTarget,
  repoPath: string,
  io: InstallIo = nodeInstallIo,
): Promise<{ profile: StackProfile }> {
  if (target !== "claude")
    throw new InstallError(`the backpressure-loop pack supports claude only (got "${target}").`);
  await init(target, repoPath, { withLoop: true, io });
  await installPack(join(bundledPacksDir(), "backpressure-loop"), target, repoPath, io);
  const { profile } = await writeTunedGate(repoPath, io, { force: true });
  return { profile };
}
