/**
 * Shared, CLI-agnostic subagent definition — the single source of truth a
 * context-isolated specialist (e.g. a reviewer) is authored in. The Claude
 * (Markdown) and Codex (TOML) adapters each compile this same shape into their
 * native config; no subagent fact is duplicated between them.
 */

/**
 * One subagent. `name` is its stable identifier (and Claude file stem),
 * `description` is the one-line summary the CLI shows / routes on, `prompt` is
 * the system prompt body, and `tools` (optional) restricts which tools the
 * subagent may use — omit to inherit the full toolset.
 */
export interface SubagentDefinition {
  /** Stable identifier; also the `.claude/agents/<name>.md` file stem. */
  name: string;
  /** One-line summary the CLI displays and routes on. */
  description: string;
  /** System-prompt body that defines the subagent's behaviour. */
  prompt: string;
  /** Tool names the subagent may use. Omit to inherit all tools. */
  tools?: string[];
}
