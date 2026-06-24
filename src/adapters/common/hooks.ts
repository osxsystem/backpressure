/**
 * Shared, CLI-agnostic hook definition — the single source of truth a hook is
 * authored in. The Claude (JSON) and Codex (TOML) adapters each compile this
 * same shape into their native config; no hook fact is duplicated between them.
 */

/**
 * One guardrail hook. `event` names the lifecycle point it fires at (e.g.
 * `"Stop"` for a test-gate, `"PreToolUse"` for a scope guard). `matcher`, when
 * present, narrows the hook to matching tool calls (e.g. `"Bash"`); omit it to
 * always run. `command` is the shell command to execute.
 */
export interface HookDefinition {
  /** Lifecycle event the hook fires on, e.g. "PreToolUse" | "Stop". */
  event: string;
  /** Optional tool-name/pattern this hook applies to. Omit to match all. */
  matcher?: string;
  /** Shell command to run when the hook fires. */
  command: string;
}
