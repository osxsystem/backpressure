import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installPack } from "../../src/add/install-pack.js";
import type { InstallIo } from "../../src/install/init.js";

function fakeIo(seed: Record<string, string>) {
  const files = new Map<string, string>(Object.entries(seed));
  const trees = new Map<string, string[]>(); // dir -> relative file list
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
});
