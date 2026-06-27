import {
  access,
  chmod,
  constants,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MissingSkillSourceError, SkillVerificationError } from "../../src/install/errors.js";
import type { InstallIo } from "../../src/install/init.js";
import { bundledSkillsDir, init } from "../../src/install/init.js";
import { planInstall } from "../../src/install/plan.js";

// The bundled skills dir at <repoRoot>/skills, two levels up from this file.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillsSourceDir = join(repoRoot, "skills");

describe("init", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bp-init-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("dry-run writes nothing and returns the plan", async () => {
    const result = await init("claude", dir, { dryRun: true, skillsSourceDir });

    expect(result.written).toBe(false);
    expect(result.plan).toEqual(planInstall("claude", dir));

    // Nothing was created in the temp dir.
    const entries = await readdir(dir);
    expect(entries).toEqual([]);
  });

  it("real-run writes the planned Claude files to disk", async () => {
    const result = await init("claude", dir, { skillsSourceDir });

    expect(result.written).toBe(true);
    for (const file of result.plan) {
      await expect(access(file.path)).resolves.toBeUndefined();
    }

    // The hooks file is valid JSON with the Stop test-gate.
    const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
    expect(settings.hooks.Stop).toBeDefined();

    // The bundled skill's SKILL.md was copied through.
    const skillMd = await readFile(
      join(dir, ".claude", "skills", "building-adaptive-ui", "SKILL.md"),
      "utf8",
    );
    expect(skillMd).toContain("name: building-adaptive-ui");

    // The whole skill tree is mirrored, not just SKILL.md — the bundled script
    // comes along too.
    await expect(
      access(
        join(
          dir,
          ".claude",
          "skills",
          "building-adaptive-ui",
          "scripts",
          "check-hardcoded-colors.sh",
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it("real-run writes the Codex config.toml to disk", async () => {
    const result = await init("codex", dir, { skillsSourceDir });

    expect(result.written).toBe(true);
    await expect(access(join(dir, ".codex", "config.toml"))).resolves.toBeUndefined();
    await expect(
      access(join(dir, ".codex", "skills", "building-adaptive-ui", "SKILL.md")),
    ).resolves.toBeUndefined();
  });

  it("@acceptance init writes a .codex/config.toml whose nested Stop gate command is pnpm test", async () => {
    // End-to-end proof the file Codex actually LOADS carries the loadable nested
    // gate — not just the pure emitter. Codex 0.137.0 ignores a flat [[hooks]]
    // array, so this parses the on-disk TOML and walks the nested shape.
    await init("codex", dir, { skillsSourceDir });
    const toml = await readFile(join(dir, ".codex", "config.toml"), "utf8");
    const parsed = parse(toml) as unknown as {
      hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>>;
    };
    expect(Array.isArray(parsed.hooks)).toBe(false);
    expect(parsed.hooks.Stop?.[0]?.hooks[0]?.command).toBe("pnpm test");
  });

  it("mirrors a multi-file skill's nested resources (scripts, agents, eval-viewer)", async () => {
    await init("claude", dir, {
      skillsSourceDir,
      capabilities: { subagents: [], skills: ["skill-creator"] },
    });

    const root = join(dir, ".claude", "skills", "skill-creator");
    for (const rel of [
      "SKILL.md",
      join("scripts", "run_eval.py"),
      join("agents", "grader.md"),
      join("eval-viewer", "generate_review.py"),
    ]) {
      await expect(access(join(root, rel))).resolves.toBeUndefined();
    }
  });

  it("preserves the executable bit and binary bytes when copying skill resources", async () => {
    // Hand-build a skill source dir with an executable script and a binary asset.
    const srcRoot = await mkdtemp(join(tmpdir(), "bp-src-"));
    const skill = join(srcRoot, "demo");
    await mkdir(join(skill, "scripts"), { recursive: true });
    await mkdir(join(skill, "assets"), { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: demo\ndescription: d\n---\n");
    const script = join(skill, "scripts", "run.sh");
    await writeFile(script, "#!/bin/sh\necho hi\n");
    await chmod(script, 0o755);
    // Bytes that wouldn't survive a UTF-8 round-trip.
    const bytes = Buffer.from([0xff, 0xd8, 0x00, 0x01, 0xfe]);
    await writeFile(join(skill, "assets", "icon.bin"), bytes);

    await init("claude", dir, {
      skillsSourceDir: srcRoot,
      capabilities: { subagents: [], skills: ["demo"] },
    });

    const destRoot = join(dir, ".claude", "skills", "demo");
    // Script is still executable.
    await expect(
      access(join(destRoot, "scripts", "run.sh"), constants.X_OK),
    ).resolves.toBeUndefined();
    expect((await stat(join(destRoot, "scripts", "run.sh"))).mode & 0o111).not.toBe(0);
    // Binary bytes are intact.
    const copied = await readFile(join(destRoot, "assets", "icon.bin"));
    expect(copied.equals(bytes)).toBe(true);

    await rm(srcRoot, { recursive: true, force: true });
  });

  it("rejects with MissingSkillSourceError when the skill SKILL.md is ENOENT during write", async () => {
    // This test verifies that MissingSkillSourceError is thrown from the *write*
    // phase (buildWrites / listFiles) when the source dir is absent.  We must
    // supply a fake skillsIo that reports the skill as valid so the verify gate
    // passes, while the write-phase io still throws ENOENT from listFiles.
    const fakeSourceDir = "/nonexistent/skills";
    const io: InstallIo = {
      async listFiles(_dir: string): Promise<string[]> {
        const e = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
        e.code = "ENOENT";
        throw e;
      },
      async ensureDir(_path: string): Promise<void> {},
      async writeText(_path: string, _data: string): Promise<void> {},
      async copyFile(_from: string, _to: string): Promise<void> {},
    };
    const skillsIo = {
      async listDirs(_: string): Promise<string[]> {
        return [];
      },
      async readText(_: string): Promise<string> {
        return "---\nname: building-adaptive-ui\ndescription: valid\n---\n";
      },
    };

    await expect(
      init("claude", dir, { io, skillsIo, skillsSourceDir: fakeSourceDir }),
    ).rejects.toBeInstanceOf(MissingSkillSourceError);

    await expect(
      init("claude", dir, { io, skillsIo, skillsSourceDir: fakeSourceDir }),
    ).rejects.toMatchObject({
      skillName: "building-adaptive-ui",
      sourceDir: fakeSourceDir,
    });
  });

  it("throws SkillVerificationError when a skill in the resolved set has invalid frontmatter", async () => {
    const {
      mkdtemp: _mkdtemp,
      mkdir: _mkdir,
      writeFile: _writeFile,
    } = await import("node:fs/promises");
    // Build a temp skills source dir with a broken skill.
    const srcDir = await _mkdtemp(join(tmpdir(), "bp-bad-skills-"));
    try {
      const skillDir = join(srcDir, "building-adaptive-ui");
      await _mkdir(skillDir, { recursive: true });
      // Missing description → SkillFrontmatterSchema will reject it.
      await _writeFile(
        join(skillDir, "SKILL.md"),
        "---\nname: building-adaptive-ui\n---\n",
        "utf8",
      );

      await expect(init("claude", dir, { skillsSourceDir: srcDir })).rejects.toBeInstanceOf(
        SkillVerificationError,
      );
    } finally {
      const { rm: _rm } = await import("node:fs/promises");
      await _rm(srcDir, { recursive: true, force: true });
    }
  });

  it("dry-run also aborts with SkillVerificationError before reporting a plan", async () => {
    const {
      mkdtemp: _mkdtemp,
      mkdir: _mkdir,
      writeFile: _writeFile,
      rm: _rm,
    } = await import("node:fs/promises");
    const srcDir = await _mkdtemp(join(tmpdir(), "bp-bad-dry-"));
    try {
      const skillDir = join(srcDir, "building-adaptive-ui");
      await _mkdir(skillDir, { recursive: true });
      await _writeFile(
        join(skillDir, "SKILL.md"),
        "---\nname: building-adaptive-ui\n---\n",
        "utf8",
      );

      await expect(
        init("claude", dir, { dryRun: true, skillsSourceDir: srcDir }),
      ).rejects.toBeInstanceOf(SkillVerificationError);
    } finally {
      await _rm(srcDir, { recursive: true, force: true });
    }
  });

  it("skillsOnly: true writes only skill files and omits hooks/mcp/agents", async () => {
    const result = await init("claude", dir, { skillsOnly: true, skillsSourceDir });

    expect(result.written).toBe(true);
    // All planned files must be skills.
    for (const file of result.plan) {
      expect(file.kind).toBe("skill");
    }
    // The settings.json hook file must NOT exist.
    const { access: _access } = await import("node:fs/promises");
    const { constants: _constants } = await import("node:fs");
    await expect(_access(join(dir, ".claude", "settings.json"))).rejects.toThrow();
    // But the skill should have been installed.
    await expect(
      _access(join(dir, ".claude", "skills", "building-adaptive-ui", "SKILL.md")),
    ).resolves.toBeUndefined();
  });
});

describe("bundledSkillsDir", () => {
  it("resolves the pack's own skills dir regardless of cwd", () => {
    const resolved = bundledSkillsDir();
    // Ends at <package-root>/skills and is the repo's real bundled dir.
    expect(resolved).toBe(skillsSourceDir);
  });

  it("contains the default bundled skill", async () => {
    await expect(
      access(join(bundledSkillsDir(), "building-adaptive-ui", "SKILL.md")),
    ).resolves.toBeUndefined();
  });
});
