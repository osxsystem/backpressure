import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UnknownSkillError } from "../../src/install/errors.js";
import {
  DEFAULT_CAPABILITIES,
  planInstall,
  resolveInstalledSkills,
} from "../../src/install/plan.js";

const repo = "/tmp/repo";

describe("planInstall", () => {
  it("plans the Claude file layout (settings.json, agents, skills; no .mcp.json by default)", () => {
    const files = planInstall("claude", repo);
    expect(files).toEqual([
      { path: join(repo, ".claude", "settings.json"), kind: "hooks" },
      { path: join(repo, ".claude", "agents", "reviewer.md"), kind: "agent" },
      { path: join(repo, ".claude", "agents", "researcher.md"), kind: "agent" },
      {
        path: join(repo, ".claude", "skills", "building-adaptive-ui", "SKILL.md"),
        kind: "skill",
      },
    ]);
  });

  it("bundles a read-only researcher for safe parallel fan-out (no Write/Edit tools)", () => {
    const researcher = DEFAULT_CAPABILITIES.subagents.find((s) => s.name === "researcher");
    expect(researcher).toBeDefined();
    // Read-only by construction is the whole point: many can run in parallel
    // without write-collisions (see the fan-out discipline in PROMPT.md).
    expect(researcher?.tools).toEqual(["Read", "Grep", "Glob"]);
    expect(researcher?.tools).not.toContain("Write");
    expect(researcher?.tools).not.toContain("Edit");
  });

  it("plans .mcp.json only when MCP servers are registered", () => {
    const withServer = planInstall("claude", repo, {
      subagents: [],
      mcpServers: [{ name: "tracker", command: "node", args: ["server.js"] }],
      skills: [],
    });
    expect(withServer).toContainEqual({ path: join(repo, ".mcp.json"), kind: "mcp" });

    const withoutServer = planInstall("claude", repo, { subagents: [], skills: [] });
    expect(withoutServer.some((f) => f.kind === "mcp")).toBe(false);
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

  it("derives agent files from a custom skill list", () => {
    const files = planInstall("claude", repo, { subagents: [], skills: ["skill-creator"] });
    const skillPaths = files.filter((f) => f.kind === "skill").map((f) => f.path);
    expect(skillPaths).toEqual([join(repo, ".claude", "skills", "skill-creator", "SKILL.md")]);
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

describe("resolveInstalledSkills", () => {
  const available = ["building-adaptive-ui", "skill-creator"];

  it("returns the defaults when no opt-ins are given", () => {
    expect(resolveInstalledSkills(available)).toEqual(DEFAULT_CAPABILITIES.skills);
  });

  it("adds opt-in skills to the defaults, de-duplicated", () => {
    expect(resolveInstalledSkills(available, { extra: ["skill-creator"] })).toEqual([
      ...DEFAULT_CAPABILITIES.skills,
      "skill-creator",
    ]);
    // An opt-in that's already a default doesn't duplicate.
    expect(resolveInstalledSkills(available, { extra: ["building-adaptive-ui"] })).toEqual(
      DEFAULT_CAPABILITIES.skills,
    );
  });

  it("returns every discovered skill when all is set", () => {
    expect(resolveInstalledSkills(available, { all: true })).toEqual(available);
  });

  it("throws UnknownSkillError for an opt-in that isn't bundled", () => {
    expect(() => resolveInstalledSkills(available, { extra: ["nope"] })).toThrow(UnknownSkillError);
  });
});
