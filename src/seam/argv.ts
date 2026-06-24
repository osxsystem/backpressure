import { type AgentTarget, flagsFor } from "./targets.js";

/**
 * Knobs for one headless agent invocation. All optional; an omitted knob means
 * "do not pass that flag". `headless` and `permission` default to `true` because
 * the loop always runs non-interactively with prompts bypassed (see `ralph.sh`).
 */
export interface AgentOpts {
  /** Pass the headless sub-command/flag (`-p` / `exec`). Defaults to `true`. */
  headless?: boolean;
  /**
   * Pass the permission/sandbox-bypass flag. Defaults to `true`. Maps to the
   * single concept "skip approvals"; spelled per target in {@link flagsFor}.
   */
  permission?: boolean;
  /** Model name, e.g. "opus". Emitted as `--model <name>` where supported. */
  model?: string;
  /** Cap on actions/turns. Emitted as `--max-turns <n>` where supported. */
  maxTurns?: number;
}

/**
 * Build the full argv (the arguments after the binary name) for a headless
 * agent run. Pure — no I/O — so the exact contract is unit-testable.
 *
 * Order is fixed and identical in shape across targets:
 *   `[<headless>, <prompt>, <permission>, --model <name>?, --max-turns <n>?]`
 *
 * Per `ralph.sh` this yields, given `{ model: "m", maxTurns: 5 }`:
 *   - claude: `["-p", prompt, "--dangerously-skip-permissions", "--model", "m", "--max-turns", "5"]`
 *   - codex:  `["exec", prompt, "--dangerously-bypass-approvals-and-sandbox", "--model", "m"]`
 *     (Codex has no max-turns flag, so it is dropped even when requested.)
 *
 * Flags whose spelling is `null` for a target are skipped silently.
 */
export function buildArgv(target: AgentTarget, prompt: string, opts: AgentOpts = {}): string[] {
  const flags = flagsFor(target);
  const { headless = true, permission = true, model, maxTurns } = opts;

  const argv: string[] = [];

  if (headless) argv.push(flags.headless);
  argv.push(prompt);
  if (permission) argv.push(flags.permission);

  if (model !== undefined && flags.model !== null) {
    argv.push(flags.model, model);
  }
  if (maxTurns !== undefined && flags.maxTurns !== null) {
    argv.push(flags.maxTurns, String(maxTurns));
  }

  return argv;
}
