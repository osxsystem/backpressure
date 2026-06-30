import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTarGzip } from "nanotar";
import { describe, expect, it } from "vitest";
import { addPack } from "../../src/add/add.js";
import { nodeBytesIo } from "../../src/add/fetch.js";
import { InvalidPackManifestError } from "../../src/install/errors.js";
import { nodeInstallIo } from "../../src/install/init.js";

const SHA = "b".repeat(40);
const manifest = JSON.stringify({
  name: "demo",
  version: "1.0.0",
  targets: ["claude"],
  items: [{ type: "command", name: "demo", path: "commands/demo.md" }],
  scripts: [],
});

describe("addPack (@acceptance)", () => {
  it("fetches, trust-gates, installs, and writes the lock", async () => {
    const base = await mkdtemp(join(tmpdir(), "bp-addbase-"));
    const files = [
      { name: `demo-${SHA}/backpressure.json`, data: manifest },
      { name: `demo-${SHA}/commands/demo.md`, data: "# Demo command\n" },
    ];
    const { files: written, sha } = await addPack(
      "o/demo",
      { choice: "claude", baseDir: base, yes: true },
      {
        io: nodeInstallIo,
        bytesIo: nodeBytesIo,
        fetcher: {
          resolveSha: async () => SHA,
          downloadTarball: async () => createTarGzip(files),
        },
        prompter: { confirm: async () => true },
      },
    );
    expect(sha).toBe(SHA);
    expect(written).toContain(".claude/commands/demo.md");
    const lock = JSON.parse(await readFile(join(base, ".backpressure/backpressure.lock"), "utf8"));
    expect(lock).toMatchObject({ source: "o/demo", sha: SHA, ref: "default" });
    await expect(stat(join(base, ".claude/commands/demo.md"))).resolves.toBeDefined();
  });

  it("@acceptance surfaces a clean error (no raw ENOENT) when the resolved root has no backpressure.json", async () => {
    const base = await mkdtemp(join(tmpdir(), "bp-addbase-"));
    // The manifest lives in a subdir; the repo root has none. Pointing `add` at the
    // bare repo (no subdir) must fail cleanly, naming the source — not crash with a
    // raw fs ENOENT stack trace.
    const files = [{ name: `demo-${SHA}/packs/demo/backpressure.json`, data: manifest }];
    const run = addPack(
      "o/demo",
      { choice: "claude", baseDir: base, yes: true },
      {
        io: nodeInstallIo,
        bytesIo: nodeBytesIo,
        fetcher: {
          resolveSha: async () => SHA,
          downloadTarball: async () => createTarGzip(files),
        },
        prompter: { confirm: async () => true },
      },
    );
    await expect(run).rejects.toThrow(InvalidPackManifestError);
    await expect(run).rejects.toThrow(/not found at o\/demo/i);
    // Atomic: nothing installed when the manifest is missing.
    await expect(stat(join(base, ".claude"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
