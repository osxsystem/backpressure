import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { init } from "../../src/install/init.js";

// The bundled skills dir at <repoRoot>/skills, three levels up from this file.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillsSourceDir = join(repoRoot, "skills");

// The skill that ships in this repo (and is in DEFAULT_CAPABILITIES).
const bundledSkill = "building-adaptive-ui";

describe("e2e install smoke", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bp-e2e-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("installs both targets so .claude/ and .codex/ artifacts exist and parse", async () => {
    // Run the real installer (real nodeInstallIo) for both CLIs into one repo.
    const claudeResult = await init("claude", dir, { skillsSourceDir });
    const codexResult = await init("codex", dir, { skillsSourceDir });
    expect(claudeResult.written).toBe(true);
    expect(codexResult.written).toBe(true);

    // --- Claude artifacts: settings.json is valid JSON. ---
    const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
    expect(settings.hooks).toBeDefined();

    // No MCP servers are registered in v0, so no .mcp.json is written.
    await expect(access(join(dir, ".mcp.json"))).rejects.toThrow();

    // The Claude skill SKILL.md was written.
    await expect(
      access(join(dir, ".claude", "skills", bundledSkill, "SKILL.md")),
    ).resolves.toBeUndefined();

    // --- Codex artifacts: config.toml parses as TOML. ---
    const config = parseToml(await readFile(join(dir, ".codex", "config.toml"), "utf8"));
    expect(config).toBeTypeOf("object");

    // The Codex skill SKILL.md was written.
    await expect(
      access(join(dir, ".codex", "skills", bundledSkill, "SKILL.md")),
    ).resolves.toBeUndefined();
  });
});
