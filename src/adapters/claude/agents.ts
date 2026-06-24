import type { SubagentDefinition } from "../common/agents.js";

/** One emitted Claude subagent file: where it goes and what it contains. */
export interface ClaudeAgentFile {
  /** Repo-relative path, e.g. `.claude/agents/reviewer.md`. */
  path: string;
  /** Full Markdown contents: YAML frontmatter + prompt body. */
  contents: string;
}

/**
 * Compile shared {@link SubagentDefinition}s into Claude Code subagent files.
 * Each definition becomes a `.claude/agents/<name>.md` file whose YAML
 * frontmatter carries `name`/`description` (and `tools` as a comma-separated
 * list when present), followed by the prompt body. The same definition drives
 * {@link emitCodexAgents}, so the two stay in lock-step.
 *
 * Pure — returns the file list the installer writes; no I/O here.
 */
export function emitClaudeAgents(defs: SubagentDefinition[]): ClaudeAgentFile[] {
  return defs.map((def) => {
    const frontmatter = [
      "---",
      `name: ${def.name}`,
      `description: ${def.description}`,
      ...(def.tools !== undefined ? [`tools: ${def.tools.join(", ")}`] : []),
      "---",
    ].join("\n");

    return {
      path: `.claude/agents/${def.name}.md`,
      contents: `${frontmatter}\n\n${def.prompt}\n`,
    };
  });
}
