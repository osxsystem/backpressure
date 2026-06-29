import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTarGzip } from "nanotar";
import { describe, expect, it } from "vitest";
import type { PackFetcher } from "../../src/add/fetch.js";
import { fetchPack, nodeBytesIo } from "../../src/add/fetch.js";

// GitHub tarballs wrap everything in a top-level "<repo>-<sha>/" dir.
// NOTE: nanotar's TarFileAttrs.mode is a string (e.g. "755"), not a number.
async function fakeTarball(prefix: string): Promise<Uint8Array> {
  return createTarGzip([
    { name: `${prefix}/backpressure.json`, data: '{"name":"p"}' },
    { name: `${prefix}/scripts/gate.sh`, data: "#!/bin/sh\n", attrs: { mode: "755" } },
  ]);
}

describe("fetchPack", () => {
  it("pins the sha, strips the top dir, and extracts files to a temp dir", async () => {
    const sha = "a".repeat(40);
    const fetcher: PackFetcher = {
      resolveSha: async () => sha,
      downloadTarball: async () => fakeTarball(`backpressure-${sha}`),
    };
    const { dir, sha: pinned } = await fetchPack(
      { owner: "o", repo: "backpressure" },
      nodeBytesIo,
      fetcher,
    );
    expect(pinned).toBe(sha);
    expect(await readFile(join(dir, "backpressure.json"), "utf8")).toContain('"name":"p"');
    expect(await readFile(join(dir, "scripts/gate.sh"), "utf8")).toContain("#!/bin/sh");
  });
});
