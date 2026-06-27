/**
 * The CLI-invocation seam — the one real CLI-specific abstraction. Each agent
 * CLI (Claude Code, Codex) has its own flag spelling for the same concepts
 * (headless run, permission/sandbox bypass, model, max-turns). This module is
 * the single source of truth for those spellings; everything downstream
 * (argv building, running) reads from here so no flag name is duplicated.
 */

/** The agent CLIs Backpressure can drive headless. */
export type AgentTarget = "claude" | "codex";

/**
 * The per-target flag spellings for each invocation concept. A `null` value
 * means the target has no flag for that concept (e.g. Codex takes no model or
 * max-turns flag in the headless invocation we wrap).
 */
export interface TargetFlags {
  /**
   * The leading sub-command/flag that puts the CLI into headless
   * (non-interactive) mode: `claude -p "<prompt>"`, `codex exec "<prompt>"`.
   */
  headless: string;
  /**
   * The flag that bypasses interactive permission/approval prompts (and, for
   * Codex, the sandbox). DANGEROUS — only safe in a throwaway worktree.
   */
  permission: string;
  /** The flag that selects a model by name, or `null` if unsupported. */
  model: string | null;
  /** The flag that caps actions/turns per run, or `null` if unsupported. */
  maxTurns: string | null;
}

/**
 * Flag spellings per target, mirroring each CLI's real headless invocation:
 *
 * - claude: `claude -p "<prompt>" --dangerously-skip-permissions --max-turns <n> --model <name>`
 * - codex:  `codex exec "<prompt>" --dangerously-bypass-approvals-and-sandbox --model <name>`
 */
export const TARGET_FLAGS: Record<AgentTarget, TargetFlags> = {
  claude: {
    headless: "-p",
    permission: "--dangerously-skip-permissions",
    model: "--model",
    maxTurns: "--max-turns",
  },
  codex: {
    headless: "exec",
    permission: "--dangerously-bypass-approvals-and-sandbox",
    model: "--model",
    maxTurns: null,
  },
};

/** Look up the flag spellings for a target. */
export function flagsFor(target: AgentTarget): TargetFlags {
  return TARGET_FLAGS[target];
}
