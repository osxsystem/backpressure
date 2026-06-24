import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { emitClaudeAgents } from "../../src/adapters/claude/agents.js";
import { emitCodexAgents } from "../../src/adapters/codex/agents.js";
import type { SubagentDefinition } from "../../src/adapters/common/agents.js";

const reviewer: SubagentDefinition = {
  name: "reviewer",
  description: "Reviews a diff for scope creep and missing tests.",
  prompt: "You are a careful code reviewer. Report only concrete issues.",
  tools: ["Read", "Grep"],
};

describe("subagent emitters (one shared definition -> two targets)", () => {
  it("emitClaudeAgents writes a .claude/agents/<name>.md with frontmatter + body", () => {
    const files = emitClaudeAgents([reviewer]);
    expect(files).toHaveLength(1);

    const file = files[0];
    expect(file?.path).toBe(".claude/agents/reviewer.md");
    expect(file?.contents).toContain("---\n");
    expect(file?.contents).toContain("name: reviewer");
    expect(file?.contents).toContain(
      "description: Reviews a diff for scope creep and missing tests.",
    );
    expect(file?.contents).toContain("tools: Read, Grep");
    // The prompt body follows the closing fence.
    expect(file?.contents).toContain(
      "\n---\n\nYou are a careful code reviewer. Report only concrete issues.\n",
    );
  });

  it("emitCodexAgents stringifies an [agents.<name>] table that round-trips", () => {
    const toml = emitCodexAgents([reviewer]);
    expect(typeof toml).toBe("string");

    const parsed = parse(toml) as unknown as {
      agents: Record<string, { description: string; prompt: string; tools: string[] }>;
    };
    expect(parsed.agents.reviewer).toEqual({
      description: "Reviews a diff for scope creep and missing tests.",
      prompt: "You are a careful code reviewer. Report only concrete issues.",
      tools: ["Read", "Grep"],
    });
  });

  it("both outputs derive from the same definition's fields", () => {
    const claude = emitClaudeAgents([reviewer])[0];
    const codex = parse(emitCodexAgents([reviewer])) as unknown as {
      agents: Record<string, { description: string; prompt: string }>;
    };

    // The description and prompt agree across both compiled targets.
    expect(claude?.contents).toContain(reviewer.description);
    expect(claude?.contents).toContain(reviewer.prompt);
    expect(codex.agents.reviewer?.description).toBe(reviewer.description);
    expect(codex.agents.reviewer?.prompt).toBe(reviewer.prompt);
  });

  it("omits tools when the definition has none", () => {
    const noTools: SubagentDefinition = {
      name: "planner",
      description: "Plans work.",
      prompt: "Plan the work.",
    };

    const claude = emitClaudeAgents([noTools])[0];
    expect(claude?.contents).not.toContain("tools:");

    const codex = parse(emitCodexAgents([noTools])) as unknown as {
      agents: Record<string, Record<string, unknown>>;
    };
    expect(codex.agents.planner).not.toHaveProperty("tools");
  });
});
