import type { McpServerDefinition } from "../common/mcp.js";

/** One server entry inside the Claude `.mcp.json` `mcpServers` object. */
export interface ClaudeMcpEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** The `.mcp.json` object Claude Code reads: servers keyed by name. */
export interface ClaudeMcpConfig {
  mcpServers: Record<string, ClaudeMcpEntry>;
}

/**
 * Compile shared {@link McpServerDefinition}s into the Claude Code `.mcp.json`
 * object. Each definition becomes an entry under `mcpServers` keyed by its
 * `name`, carrying `command`/`args` (and `env` only when present). The same
 * definitions drive {@link emitCodexMcp}, so the two stay in lock-step.
 *
 * Pure — returns a plain JS object the installer can `JSON.stringify`.
 */
export function emitClaudeMcp(servers: McpServerDefinition[]): ClaudeMcpConfig {
  const mcpServers: Record<string, ClaudeMcpEntry> = {};

  for (const server of servers) {
    mcpServers[server.name] = {
      command: server.command,
      args: server.args,
      ...(server.env !== undefined ? { env: server.env } : {}),
    };
  }

  return { mcpServers };
}
