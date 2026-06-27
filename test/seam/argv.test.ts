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

  it("@acceptance appends per-target json-output tokens only when json is requested", () => {
    expect(buildArgv("claude", prompt, { json: true })).toEqual([
      "-p",
      "do the task",
      "--dangerously-skip-permissions",
      "--output-format",
      "json",
    ]);
    expect(buildArgv("codex", prompt, { json: true })).toEqual([
      "exec",
      "do the task",
      "--dangerously-bypass-approvals-and-sandbox",
      "--json",
    ]);
    // Appended LAST (after --max-turns); a json-off argv is byte-unchanged.
    expect(buildArgv("claude", prompt, { model: "opus", maxTurns: 40, json: true })).toEqual([
      "-p",
      "do the task",
      "--dangerously-skip-permissions",
      "--model",
      "opus",
      "--max-turns",
      "40",
      "--output-format",
      "json",
    ]);
    expect(buildArgv("claude", prompt)).toEqual([
      "-p",
      "do the task",
      "--dangerously-skip-permissions",
    ]);
  });
});
