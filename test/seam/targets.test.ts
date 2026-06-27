import { describe, expect, it } from "vitest";
import { type AgentTarget, flagsFor, TARGET_FLAGS } from "../../src/seam/targets.js";

describe("TARGET_FLAGS", () => {
  it("captures the headless + permission flags for claude", () => {
    const claude = TARGET_FLAGS.claude;
    expect(claude.headless).toBe("-p");
    expect(claude.permission).toBe("--dangerously-skip-permissions");
  });

  it("captures the headless + permission flags for codex", () => {
    const codex = TARGET_FLAGS.codex;
    expect(codex.headless).toBe("exec");
    expect(codex.permission).toBe("--dangerously-bypass-approvals-and-sandbox");
  });

  it("exposes per-target flags via flagsFor", () => {
    const targets: AgentTarget[] = ["claude", "codex"];
    for (const target of targets) {
      const flags = flagsFor(target);
      expect(flags.headless).toBeTruthy();
      expect(flags.permission).toBeTruthy();
    }
  });

  it("models model/maxTurns support per target", () => {
    // Claude supports both --model and --max-turns.
    expect(flagsFor("claude").model).toBe("--model");
    expect(flagsFor("claude").maxTurns).toBe("--max-turns");
    // Codex takes --model but no max-turns flag in the headless call.
    expect(flagsFor("codex").model).toBe("--model");
    expect(flagsFor("codex").maxTurns).toBeNull();
  });
});
