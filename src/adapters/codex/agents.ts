import { stringify } from "smol-toml";
import type { SubagentDefinition } from "../common/agents.js";

/** One subagent table as it appears under `[agents.<name>]` in `config.toml`. */
interface CodexAgentTable {
  description: string;
  prompt: string;
  tools?: string[];
}

/**
 * Compile shared {@link SubagentDefinition}s into a Codex `config.toml`
 * fragment string. Each definition becomes an `[agents.<name>]` table carrying
 * its `description`, `prompt`, and optional `tools` array. The same
 * {@link SubagentDefinition} type drives the Claude emitter, so the two stay in
 * lock-step.
 *
 * Returns a TOML string (via `smol-toml`'s `stringify`) ready to merge into a
 * `config.toml`.
 */
export function emitCodexAgents(defs: SubagentDefinition[]): string {
  const agents: Record<string, CodexAgentTable> = {};

  for (const def of defs) {
    agents[def.name] = {
      description: def.description,
      prompt: def.prompt,
      ...(def.tools !== undefined ? { tools: def.tools } : {}),
    };
  }

  return stringify({ agents });
}
