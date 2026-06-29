import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { installPack } from "../../src/add/install-pack.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const packDir = join(repoRoot, "packs", "backpressure-loop");

// A bare `scripts/<name>` reference NOT prefixed by `.backpressure/` — the old,
// source-repo-only path that breaks when the pack is installed into a target repo.
const bareScript = (name: string) => new RegExp(`(?<!\\.backpressure/)scripts/${name}`);

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

  it("installs the ralph-loop harness, executable, pointing at the installed gate path", async () => {
    const base = await mkdtemp(join(tmpdir(), "bp-pack-"));
    const { installed } = await installPack(packDir, "claude", base);

    expect(installed.files).toContain(".backpressure/scripts/ralph-loop.sh");

    const harnessPath = join(base, ".backpressure/scripts/ralph-loop.sh");
    expect((await stat(harnessPath)).mode & 0o111).not.toBe(0); // executable

    // The harness body is copied verbatim (rewriteScriptRefs only touches hook
    // commands), so it must already reference the INSTALLED gate path.
    const harness = await readFile(harnessPath, "utf8");
    expect(harness).toContain(".backpressure/scripts/backpressure-gate.sh");
    expect(harness).not.toMatch(bareScript("backpressure-gate\\.sh"));
  });

  it("ships a command tuned for the installed-pack layout (.backpressure/scripts, no bare scripts/)", async () => {
    const base = await mkdtemp(join(tmpdir(), "bp-pack-"));
    await installPack(packDir, "claude", base);
    const cmd = await readFile(join(base, ".claude/commands/backpressure-loop.md"), "utf8");

    // References the harness + gate at their installed locations.
    expect(cmd).toContain(".backpressure/scripts/ralph-loop.sh");
    expect(cmd).toContain(".backpressure/scripts/backpressure-gate.sh");

    // No leftover source-repo-only paths that don't exist in a target repo.
    expect(cmd).not.toMatch(bareScript("ralph-loop\\.sh"));
    expect(cmd).not.toMatch(bareScript("backpressure-gate\\.sh"));
  });
});
