import { stringify } from "smol-toml";
import type { McpServerDefinition } from "../common/mcp.js";

/** One server table as it appears under `[mcp_servers.<name>]` in `config.toml`. */
interface CodexMcpTable {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Compile shared {@link McpServerDefinition}s into a Codex `config.toml`
 * fragment string. Each definition becomes an `[mcp_servers.<name>]` table
 * carrying its `command`, `args`, and optional `env`. The same
 * {@link McpServerDefinition} type drives the Claude emitter, so the two stay
 * in lock-step.
 *
 * Returns a TOML string (via `smol-toml`'s `stringify`) ready to merge into a
 * `config.toml`.
 */
export function emitCodexMcp(servers: McpServerDefinition[]): string {
  const mcpServers: Record<string, CodexMcpTable> = {};

  for (const server of servers) {
    mcpServers[server.name] = {
      command: server.command,
      args: server.args,
      ...(server.env !== undefined ? { env: server.env } : {}),
    };
  }

  return stringify({ mcp_servers: mcpServers });
}
