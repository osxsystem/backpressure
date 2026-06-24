/**
 * Shared, CLI-agnostic MCP server definition — the single source of truth an
 * MCP server registration is authored in. The Claude (`.mcp.json`) and Codex
 * (`config.toml`) adapters each compile this same shape into their native
 * config; no server fact is duplicated between them.
 */

/**
 * One MCP server the CLI should launch over stdio. `name` is its stable
 * registration key, `command` is the executable, `args` are its argv, and
 * `env` (optional) are extra environment variables to pass through.
 */
export interface McpServerDefinition {
  /** Stable registration key (the table/object key in each target's config). */
  name: string;
  /** Executable to launch the server. */
  command: string;
  /** Arguments passed to `command`. */
  args: string[];
  /** Extra environment variables for the server process. Omit if none. */
  env?: Record<string, string>;
}
