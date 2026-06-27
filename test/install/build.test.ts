import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { build, formatArtifacts } from "../../src/install/build.js";
import { type InstallIo, init, nodeInstallIo, type WriteOp } from "../../src/install/init.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillsSourceDir = join(repoRoot, "skills");

/** Narrow to the config (write) ops. */
const writeOps = (ops: WriteOp[]) => ops.flatMap((o) => (o.op === "write" ? [o] : []));

describe("build", () => {
  let out: string;

  beforeEach(async () => {
    out = await mkdtemp(join(tmpdir(), "bp-build-"));
  });
  afterEach(async () => {
    await rm(out, { recursive: true, force: true });
  });

  it('@acceptance build --target claude compiles .claude/settings.json (Stop=pnpm test) + reviewer agent, never "not yet implemented"', async () => {
    const ops = await build("claude", { skillsSourceDir });

    const settings = writeOps(ops).find((o) => o.path.endsWith("settings.json"));
    expect(settings).toBeDefined();
    const parsed = JSON.parse(settings?.contents ?? "{}");
    expect(parsed.hooks.Stop[0].hooks[0].command).toBe("pnpm test");

    expect(writeOps(ops).some((o) => o.path.endsWith(join("agents", "reviewer.md")))).toBe(true);
    expect(formatArtifacts(ops)).not.toContain("not yet implemented");
  });

  it("@acceptance build --target codex yields a single .codex/config.toml with the Stop hook and [agents.reviewer]", async () => {
    const ops = await build("codex", { skillsSourceDir });
    const writes = writeOps(ops);

    expect(writes).toHaveLength(1);
    const toml = writes[0]?.contents ?? "";
    expect(writes[0]?.path).toContain(join(".codex", "config.toml"));
    // Post codex-hooks fix: nested [[hooks.Stop]] (not a flat event = "Stop" row).
    expect(toml).toContain("[[hooks.Stop]]");
    expect(toml).toContain('command = "pnpm test"');
    expect(toml).toContain("[agents.reviewer]");
  });

  it("@acceptance build without --out is read-only (mutating InstallIo never called)", async () => {
    const calls: string[] = [];
    const spy: InstallIo = {
      listFiles: (d) => nodeInstallIo.listFiles(d), // reads the real skill tree
      async ensureDir(p) {
        calls.push(`ensureDir:${p}`);
      },
      async writeText(p) {
        calls.push(`writeText:${p}`);
      },
      async copyFile(_from, to) {
        calls.push(`copyFile:${to}`);
      },
    };

    const ops = await build("claude", { skillsSourceDir, io: spy });
    expect(ops.length).toBeGreaterThan(0);
    expect(calls).toEqual([]); // no ensureDir / writeText / copyFile
  });

  it("@acceptance build --out <dir> stages config artifacts only under <dir>, deterministically", async () => {
    const first = await build("claude", { skillsSourceDir, out });
    // The compiled config landed under <out> at its relative path.
    await expect(access(join(out, ".claude", "settings.json"))).resolves.toBeUndefined();
    await expect(access(join(out, ".claude", "agents", "reviewer.md"))).resolves.toBeUndefined();

    const before = await readFile(join(out, ".claude", "settings.json"), "utf8");
    await build("claude", { skillsSourceDir, out }); // re-run into the same dir
    const after = await readFile(join(out, ".claude", "settings.json"), "utf8");
    expect(after).toBe(before); // byte-identical on re-run

    // Only config (write) ops were staged; skill copy ops are not written by build.
    expect(first.some((o) => o.op === "copy")).toBe(true);
    await expect(
      access(join(out, ".claude", "skills", "building-adaptive-ui", "SKILL.md")),
    ).rejects.toThrow();
  });

  it("@acceptance build emits no .mcp.json and no [mcp_servers] table under the v0 default", async () => {
    const claude = await build("claude", { skillsSourceDir });
    expect(claude.some((o) => o.path.endsWith(".mcp.json"))).toBe(false);

    const codex = writeOps(await build("codex", { skillsSourceDir }));
    expect(codex[0]?.contents ?? "").not.toContain("[mcp_servers");
  });

  it("@acceptance build's config bytes equal init's and build.ts adds no per-target branch", async () => {
    const installDir = await mkdtemp(join(tmpdir(), "bp-init-cmp-"));
    try {
      await init("claude", installDir, { skillsSourceDir });
      await build("claude", { skillsSourceDir, out });

      for (const rel of [
        join(".claude", "settings.json"),
        join(".claude", "agents", "reviewer.md"),
      ]) {
        const installed = await readFile(join(installDir, rel), "utf8");
        const compiled = await readFile(join(out, rel), "utf8");
        expect(compiled).toBe(installed); // byte-parity with init
      }
    } finally {
      await rm(installDir, { recursive: true, force: true });
    }

    // The only which-CLI branching lives in src/seam / src/adapters / the shared
    // plan path — build.ts must add none.
    const src = await readFile(join(repoRoot, "src", "install", "build.ts"), "utf8");
    expect(src).not.toMatch(/target\s*===|if\s*\(\s*target\b/);
  });

  it("@acceptance formatArtifacts dumps the compiled config body, not just headers", async () => {
    // Guards the preview command's core purpose: stdout carries the actual config
    // bytes (a header-only output would still pass the other assertions).
    const printed = formatArtifacts(await build("claude", { skillsSourceDir }));
    expect(printed).toContain('"command": "pnpm test"');
  });

  it("@acceptance build writes no dist/ and never imports tsup (independent of pnpm run build)", async () => {
    await build("claude", { skillsSourceDir, out });
    await expect(access(join(out, "dist"))).rejects.toThrow();
    // No tsup IMPORT/require (the doc comment may mention it to contrast).
    const src = await readFile(join(repoRoot, "src", "install", "build.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']tsup["']|require\(\s*["']tsup["']\s*\)/);
  });

  it('@acceptance build --out "" stays read-only (empty out never enables cwd writes)', async () => {
    const calls: string[] = [];
    const spy: InstallIo = {
      listFiles: (d) => nodeInstallIo.listFiles(d),
      async ensureDir(p) {
        calls.push(`ensureDir:${p}`);
      },
      async writeText(p) {
        calls.push(`writeText:${p}`);
      },
      async copyFile(_from, to) {
        calls.push(`copyFile:${to}`);
      },
    };
    await build("claude", { skillsSourceDir, io: spy, out: "" });
    expect(calls).toEqual([]);
  });
});
