import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installPack } from "../../src/add/install-pack.js";
import { InvalidPackManifestError } from "../../src/install/errors.js";
import type { InstallIo } from "../../src/install/init.js";

function fakeIo(seed: Record<string, string>, emptyDirs: string[] = []) {
  const files = new Map<string, string>(Object.entries(seed));
  const trees = new Map<string, string[]>(); // dir -> relative file list
  // Register explicitly-empty dirs first so listFiles can answer `[]` for them
  // (a seeded child below would overwrite, which is fine — a dir is only empty
  // if nothing was seeded under it).
  for (const dir of emptyDirs) {
    trees.set(dir, []);
  }
  for (const p of Object.keys(seed)) {
    // register parents so listFiles can answer for a skill dir
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      const rel = parts.slice(i).join("/");
      trees.set(dir, [...(trees.get(dir) ?? []), rel]);
    }
  }
  const io: InstallIo & { written: Map<string, string> } = {
    written: new Map(),
    async readText(p) {
      const v = files.get(p);
      if (v === undefined) {
        const e: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
        e.code = "ENOENT";
        throw e;
      }
      return v;
    },
    async listFiles(dir) {
      const rels = trees.get(dir);
      if (rels === undefined) {
        const e: NodeJS.ErrnoException = new Error(`ENOENT: ${dir}`);
        e.code = "ENOENT";
        throw e;
      }
      return rels;
    },
    async ensureDir() {},
    async writeText(p, data) {
      this.written.set(p, data);
    },
    async copyFile(from, to) {
      this.written.set(to, files.get(from) ?? "");
    },
  };
  return io;
}

const manifest = JSON.stringify({
  name: "loop",
  version: "1.0.0",
  targets: ["claude"],
  items: [
    { type: "command", name: "backpressure-loop", path: "commands/backpressure-loop.md" },
    { type: "hook", event: "Stop", command: "./scripts/gate.sh" },
  ],
  scripts: ["scripts/gate.sh"],
});

describe("installPack (@acceptance)", () => {
  it("installs a Claude pack: command, hook→settings, script→.backpressure, installed.json", async () => {
    const io = fakeIo({
      "/pack/backpressure.json": manifest,
      "/pack/commands/backpressure-loop.md": "# loop",
      "/pack/scripts/gate.sh": "#!/bin/sh\n",
    });
    const { installed } = await installPack("/pack", "claude", "/repo", io);

    expect(io.written.has(join("/repo", ".claude/commands/backpressure-loop.md"))).toBe(true);
    expect(io.written.has(join("/repo", ".backpressure/scripts/gate.sh"))).toBe(true);
    expect(io.written.get(join("/repo", ".claude/settings.json"))).toContain(
      ".backpressure/scripts/gate.sh",
    );
    expect(installed.hooks).toEqual([
      { event: "Stop", command: "./.backpressure/scripts/gate.sh" },
    ]);
    expect(io.written.get(join("/repo", ".backpressure/installed.json"))).toContain(
      '"choice": "claude"',
    );
  });

  it("refuses a target the manifest does not declare", async () => {
    const io = fakeIo({ "/pack/backpressure.json": manifest });
    await expect(installPack("/pack", "codex", "/repo", io)).rejects.toThrow(/does not support/);
  });

  const skillManifest = JSON.stringify({
    name: "loop",
    version: "1.0.0",
    targets: ["claude"],
    items: [{ type: "skill", name: "loop", path: "skills/loop" }],
    scripts: [],
  });

  it("rejects InvalidPackManifestError when an item source dir is missing (ENOENT)", async () => {
    // Only the manifest is seeded — listFiles("/pack/skills/loop") throws ENOENT.
    const io = fakeIo({ "/pack/backpressure.json": skillManifest });
    await expect(installPack("/pack", "claude", "/repo", io)).rejects.toThrow(
      InvalidPackManifestError,
    );
  });

  it("rejects InvalidPackManifestError when an item source dir is empty", async () => {
    // listFiles("/pack/skills/loop") returns [] (registered empty), hitting the
    // "source is empty" guard rather than the ENOENT path.
    const io = fakeIo({ "/pack/backpressure.json": skillManifest }, ["/pack/skills/loop"]);
    await expect(installPack("/pack", "claude", "/repo", io)).rejects.toThrow(
      InvalidPackManifestError,
    );
  });

  it("@acceptance writes NOTHING into the target when a source is missing (atomic install, no stale dir)", async () => {
    // Real-fs repro of the QA finding: a manifest that references a missing
    // source must not leave a partial install (e.g. a stale `.backpressure/
    // scripts/` dir or an already-copied earlier script) behind.
    const pack = await mkdtemp(join(tmpdir(), "bp-pack-"));
    const repo = await mkdtemp(join(tmpdir(), "bp-repo-"));
    try {
      await mkdir(join(pack, "scripts"), { recursive: true });
      await mkdir(join(pack, "commands"), { recursive: true });
      await writeFile(join(pack, "commands", "demo.md"), "# demo\n");
      await writeFile(join(pack, "scripts", "present.sh"), "#!/bin/sh\n");
      // scripts/missing.sh is intentionally absent — and is ordered AFTER
      // present.sh, so the buggy path copies present.sh before it fails.
      await writeFile(
        join(pack, "backpressure.json"),
        JSON.stringify({
          name: "p",
          version: "1.0.0",
          targets: ["claude"],
          items: [{ type: "command", name: "demo", path: "commands/demo.md" }],
          scripts: ["scripts/present.sh", "scripts/missing.sh"],
        }),
      );

      await expect(installPack(pack, "claude", repo)).rejects.toThrow(InvalidPackManifestError);
      // Atomic: the failed install leaves the target untouched.
      expect(await readdir(repo)).toEqual([]);
    } finally {
      await rm(pack, { recursive: true, force: true });
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("rejects InvalidPackManifestError when a command source file is missing (ENOENT on copyFile)", async () => {
    // The manifest declares a command whose source file is NOT seeded,
    // so io.copyFile should throw ENOENT → InvalidPackManifestError.
    const manifestWithCommand = JSON.stringify({
      name: "loop",
      version: "1.0.0",
      targets: ["claude"],
      items: [{ type: "command", name: "my-cmd", path: "commands/my-cmd.md" }],
      scripts: [],
    });
    const io: typeof import("../../src/install/init.js").nodeInstallIo & {
      written: Map<string, string>;
    } = {
      written: new Map(),
      async readText(p: string) {
        if (p === "/pack/backpressure.json") return manifestWithCommand;
        const e: NodeJS.ErrnoException = new Error(`ENOENT: ${p}`);
        e.code = "ENOENT";
        throw e;
      },
      async listFiles(dir: string) {
        const e: NodeJS.ErrnoException = new Error(`ENOENT: ${dir}`);
        e.code = "ENOENT";
        throw e;
      },
      async ensureDir() {},
      async writeText(p: string, data: string) {
        this.written.set(p, data);
      },
      async copyFile(from: string, _to: string) {
        const e: NodeJS.ErrnoException = new Error(`ENOENT: ${from}`);
        e.code = "ENOENT";
        throw e;
      },
    };
    await expect(installPack("/pack", "claude", "/repo", io)).rejects.toThrow(
      InvalidPackManifestError,
    );
  });
});
