// test/install/with-loop.test.ts
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installWithLoop } from "../../src/install/with-loop.js";

describe("installWithLoop (@acceptance)", () => {
  it("installs the loop pack and leaves the gate hook as the only Stop hook", async () => {
    const base = await mkdtemp(join(tmpdir(), "bp-withloop-"));
    await installWithLoop("claude", base);

    // loop pack artifacts present
    await expect(stat(join(base, ".claude/commands/backpressure-loop.md"))).resolves.toBeDefined();
    await expect(
      stat(join(base, ".backpressure/scripts/backpressure-gate.sh")),
    ).resolves.toBeDefined();

    // exactly the gate Stop hook — NOT `<pm> test`
    const settings = JSON.parse(await readFile(join(base, ".claude/settings.json"), "utf8"));
    const cmd = settings.hooks.Stop[0].hooks[0].command;
    expect(cmd).toContain("backpressure-gate.sh");
    expect(cmd).not.toContain(" test");
  });

  it("rejects --with-loop for codex (the loop pack is claude-only)", async () => {
    const base = await mkdtemp(join(tmpdir(), "bp-withloop-codex-"));
    await expect(installWithLoop("codex", base)).rejects.toBeDefined();
  });
});
