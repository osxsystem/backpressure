import { describe, expect, it } from "vitest";
import { type AgentOpts, buildArgv } from "../../src/seam/argv.js";

describe("buildArgv", () => {
  const prompt = "do the task";
  const opts: AgentOpts = { model: "opus", maxTurns: 40 };

  it("produces the exact argv for claude given identical opts", () => {
    expect(buildArgv("claude", prompt, opts)).toEqual([
      "-p",
      "do the task",
      "--dangerously-skip-permissions",
      "--model",
      "opus",
      "--max-turns",
      "40",
    ]);
  });

  it("produces the exact argv for codex given identical opts", () => {
    // Codex has no max-turns flag, so it is omitted even though opts requested it.
    expect(buildArgv("codex", prompt, opts)).toEqual([
      "exec",
      "do the task",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "opus",
    ]);
  });

  it("defaults to headless + permission-bypass with no model/maxTurns", () => {
    expect(buildArgv("claude", prompt)).toEqual([
      "-p",
      "do the task",
      "--dangerously-skip-permissions",
    ]);
    expect(buildArgv("codex", prompt)).toEqual([
      "exec",
      "do the task",
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
  });

  it("omits the headless and permission flags when disabled", () => {
    expect(buildArgv("claude", prompt, { headless: false, permission: false })).toEqual([
      "do the task",
    ]);
  });
});
