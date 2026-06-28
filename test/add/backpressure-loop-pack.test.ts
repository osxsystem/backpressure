import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { installPack } from "../../src/add/install-pack.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const packDir = join(repoRoot, "packs", "backpressure-loop");

describe("backpressure-loop pack (@acceptance)", () => {
  it("installs the command, the gate hook, and the executable gate script", async () => {
    const base = await mkdtemp(join(tmpdir(), "bp-pack-"));
    const { installed } = await installPack(packDir, "claude", base);

    const cmd = await readFile(join(base, ".claude/commands/backpressure-loop.md"), "utf8");
    expect(cmd).toContain("Backpressure loop launcher");

    const settings = await readFile(join(base, ".claude/settings.json"), "utf8");
    expect(settings).toContain(".backpressure/scripts/backpressure-gate.sh");

    const gate = join(base, ".backpressure/scripts/backpressure-gate.sh");
    const mode = (await stat(gate)).mode;
    expect(mode & 0o111).not.toBe(0); // executable bit preserved

    expect(installed.files).toContain(".claude/commands/backpressure-loop.md");
  });
});
