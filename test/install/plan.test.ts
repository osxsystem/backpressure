import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planInstall } from "../../src/install/plan.js";

const repo = "/tmp/repo";

describe("planInstall", () => {
  it("plans the Claude file layout (settings.json, .mcp.json, agents, skills)", () => {
    const files = planInstall("claude", repo);
    expect(files).toEqual([
      { path: join(repo, ".claude", "settings.json"), kind: "hooks" },
      { path: join(repo, ".mcp.json"), kind: "mcp" },
      { path: join(repo, ".claude", "agents", "reviewer.md"), kind: "agent" },
      {
        path: join(repo, ".claude", "skills", "building-adaptive-ui", "SKILL.md"),
        kind: "skill",
      },
    ]);
  });

  it("plans the Codex file layout (config.toml + skills)", () => {
    const files = planInstall("codex", repo);
    expect(files).toEqual([
      { path: join(repo, ".codex", "config.toml"), kind: "hooks" },
      {
        path: join(repo, ".codex", "skills", "building-adaptive-ui", "SKILL.md"),
        kind: "skill",
      },
    ]);
  });

  it("derives agent files from the capability set", () => {
    const files = planInstall("claude", repo, {
      subagents: [
        { name: "planner", description: "Plans.", prompt: "Plan." },
        { name: "reviewer", description: "Reviews.", prompt: "Review." },
      ],
      skills: [],
    });
    const agentPaths = files.filter((f) => f.kind === "agent").map((f) => f.path);
    expect(agentPaths).toEqual([
      join(repo, ".claude", "agents", "planner.md"),
      join(repo, ".claude", "agents", "reviewer.md"),
    ]);
  });
});
