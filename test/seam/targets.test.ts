import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

  it("@acceptance carries jsonOutput + costPath per target", () => {
    expect(flagsFor("claude").jsonOutput).toEqual(["--output-format", "json"]);
    expect(flagsFor("claude").costPath).toBe("total_cost_usd");
    expect(flagsFor("codex").jsonOutput).toEqual(["--json"]);
    expect(flagsFor("codex").costPath).toBeNull();
  });

  it("@acceptance confines the per-CLI cost spelling to src/seam (no leak elsewhere)", async () => {
    // Author-once invariant: the cost spelling lives only in the seam. (`--json`
    // is excluded — it is also a generic CLI flag used by `index`.)
    const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
    const walk = async (dir: string): Promise<string[]> => {
      const out: string[] = [];
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...(await walk(p)));
        else if (e.name.endsWith(".ts")) out.push(p);
      }
      return out;
    };
    const seam = join("src", "seam");
    const files = (await walk(srcRoot)).filter((f) => !f.includes(seam));
    for (const f of files) {
      expect(await readFile(f, "utf8"), `${f} leaks a cost spelling`).not.toMatch(
        /total_cost_usd|--output-format/,
      );
    }
  });
});
